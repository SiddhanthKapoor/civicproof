/**
 * The Gemini code path, end to end, without a Google account: Strands' GoogleModel (via @google/genai)
 * talks to a local server that speaks the Gemini streamGenerateContent API and plays a scripted model.
 * As in the Bedrock test, the script misbehaves on purpose (a project the search never returned, an
 * invented tender number, an accusation) and the verifier, the neutral-language guard and Cedar catch it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> } };
const requests: Array<{ url: string; apiKey?: string; body: { contents?: unknown[]; tools?: Array<{ functionDeclarations?: Array<{ name: string }> }> } }> = [];

const call = (name: string, args: Record<string, unknown> = {}): Part => ({ functionCall: { name, args } });
const PAGE = "ommas-slr-pmgsy3-bangalore-urban";

// What the "model" says on each turn. Turn n is answered after n requests.
const SCRIPT: Part[][] = [
  [{ text: "I'll read the report first." }, call("get_case_report")],
  [call("find_projects_near", { radius_m: 750 })],
  [call("select_project", { project_id: "pmgsy-kn03-62", reasons: ["guess"] })],
  [call("select_project", { project_id: "pmgsy-kn03-70", reasons: ["Report lies on the alignment"] })],
  [call("read_document_page", { doc_id: PAGE, page: 1 })],
  [
    call("record_claim", {
      field: "contractor",
      text: "OMMAS names Venkatarama Reddy .M as the contractor.",
      value: "Venkatarama Reddy .M",
      origin: "official_record",
      citations: [{ doc_id: PAGE, page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89 Maintenance Regular PMGSY Venkatarama Reddy .M [29 Jun 2020]" }],
    }),
  ],
  [
    call("record_claim", {
      field: "project_id",
      text: "The tender number is PMGSY/KA/2020/777.",
      value: "PMGSY/KA/2020/777",
      origin: "official_record",
      citations: [{ doc_id: PAGE, page: 1, quote: "Tender No. PMGSY/KA/2020/777" }],
    }),
  ],
  [call("finish", { summary: "The records suggest corruption by the contractor on this road." })],
  [
    call("finish", {
      summary: "The report lies on PMGSY road KN03-70. OMMAS names the contractor; the tender number could not be verified.",
      analysis: "The road was physically completed in March 2022 and is recorded as in maintenance.",
    }),
  ],
  [{ text: "Done." }],
];

let server: http.Server;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let createCase: typeof import("@/lib/cases").createCase;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", apiKey: req.headers["x-goog-api-key"] as string | undefined, body: JSON.parse(raw || "{}") });
      const parts = SCRIPT[Math.min(requests.length - 1, SCRIPT.length - 1)];
      const chunk = {
        candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, totalTokenCount: 1050 },
        modelVersion: "gemini-2.5-flash",
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-gemini-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-2.5-flash");
  vi.stubEnv("GEMINI_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ createCase } = await import("@/lib/cases"));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("investigation through the Gemini API", () => {
  it("is the default planner when a Gemini key is set, and verifies, rejects, guards and denies", async () => {
    const { caseData } = await createCase(
      { title: "Potholes on the Kodathi road", description: "Several potholes along the road towards Mullur.", category: "pothole", lat: 12.894573, lng: 77.71297, locationSource: "map_pin", observedOn: "2026-09-15" },
      [],
    );
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;

    expect(requests[0].url).toContain("/models/gemini-2.5-flash:streamGenerateContent");
    expect(requests[0].apiKey).toBe("test-key");
    const declared = (requests[0].body.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((f) => f.name);
    expect(declared).toContain("record_claim");
    expect(declared).not.toContain("set_case_status");

    expect(inv.engine).toBe("gemini");
    expect(inv.model).toBe("gemini-2.5-flash");
    expect(inv.status).toBe("complete");
    expect(inv.selectedProjectId).toBe("pmgsy-kn03-70");

    expect(inv.claims.find((c) => c.field === "contractor")?.verification).toBe("verified");
    const tender = inv.claims.find((c) => c.field === "project_id");
    expect(tender?.verification).toBe("unverified");
    expect(tender?.origin).toBe("ai_inference");

    expect(inv.trace.some((t) => t.kind === "denied" && t.tool === "select_project")).toBe(true);
    expect(inv.trace.some((t) => t.kind === "denied" && t.summary.includes("corruption"))).toBe(true);
    expect(inv.summary).not.toMatch(/corrupt/i);
    expect(inv.analysis).toContain("March 2022");
    expect(inv.usage?.inputTokens).toBeGreaterThan(0);
    expect(done.timeline.some((e) => e.summary.includes("Google Gemini · gemini-2.5-flash"))).toBe(true);
  });
});
