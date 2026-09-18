/**
 * The Bedrock code path, end to end, without AWS: Strands' BedrockModel talks to a local server that
 * speaks the Bedrock Converse API and plays a scripted model. The script deliberately misbehaves
 * (a hallucinated contractor, an accusation, a project the search never returned) to show that the
 * verifier, the neutral-language guard and Cedar catch each one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Block = { text?: string; toolUse?: { toolUseId: string; name: string; input: unknown } };
const requests: Array<{ path: string; body: { messages: Array<{ role: string; content: unknown[] }>; toolConfig?: { tools: unknown[] } } }> = [];

// What the "model" says on each turn. Turn n is answered after n requests.
const SCRIPT: Block[][] = [
  [{ text: "I'll read the report first." }, { toolUse: { toolUseId: "t1", name: "get_case_report", input: {} } }],
  [{ toolUse: { toolUseId: "t2", name: "find_projects_near", input: { radius_m: 750 } } }],
  // A project the location search did not return → Cedar must deny.
  [{ toolUse: { toolUseId: "t3", name: "select_project", input: { project_id: "pmgsy-kn03-62", reasons: ["guess"] } } }],
  [{ toolUse: { toolUseId: "t4", name: "select_project", input: { project_id: "pmgsy-kn03-70", reasons: ["Report lies on the alignment"] } } }],
  [{ toolUse: { toolUseId: "t5", name: "read_document_page", input: { doc_id: "ommas-slr-pmgsy3-bangalore-urban", page: 1 } } }],
  // Correct, verbatim quote → verified.
  [{ toolUse: { toolUseId: "t6", name: "record_claim", input: { field: "contractor", text: "OMMAS names Venkatarama Reddy .M as the contractor.", value: "Venkatarama Reddy .M", origin: "official_record", citations: [{ doc_id: "ommas-slr-pmgsy3-bangalore-urban", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89 Maintenance Regular PMGSY Venkatarama Reddy .M [29 Jun 2020]" }] } } }],
  // Hallucinated tender number with an invented quote → unverified.
  [{ toolUse: { toolUseId: "t7", name: "record_claim", input: { field: "project_id", text: "The tender number is PMGSY/KA/2020/777.", value: "PMGSY/KA/2020/777", origin: "official_record", citations: [{ doc_id: "ommas-slr-pmgsy3-bangalore-urban", page: 1, quote: "Tender No. PMGSY/KA/2020/777" }] } } }],
  // Accusatory summary → guard steers the model to rephrase.
  [{ toolUse: { toolUseId: "t8", name: "finish", input: { summary: "The records suggest corruption by the contractor on this road." } } }],
  [{ toolUse: { toolUseId: "t9", name: "finish", input: { summary: "The report lies on PMGSY road KN03-70. OMMAS names the contractor; the tender number could not be verified.", analysis: "The road was physically completed in March 2022 and is recorded as in maintenance." } } }],
  [{ text: "Done." }],
];

let server: http2.Http2Server;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let createCase: typeof import("@/lib/cases").createCase;

beforeAll(async () => {
  // The Bedrock runtime client talks HTTP/2, so the stand-in does too (cleartext h2c).
  server = http2.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push({ path: req.url ?? "", body });
      const turn = SCRIPT[Math.min(requests.length - 1, SCRIPT.length - 1)];
      const hasTool = turn.some((b) => b.toolUse);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          output: { message: { role: "assistant", content: turn } },
          stopReason: hasTool ? "tool_use" : "end_turn",
          usage: { inputTokens: 1000, outputTokens: 50, totalTokens: 1050 },
          metrics: { latencyMs: 5 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-bedrock-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "bedrock");
  vi.stubEnv("BEDROCK_MODEL_ID", "apac.amazon.nova-pro-v1:0");
  vi.stubEnv("BEDROCK_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ createCase } = await import("@/lib/cases"));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("investigation through the Bedrock Converse API (Amazon Nova)", () => {
  it("verifies, rejects, guards and denies as designed", async () => {
    const { caseData } = await createCase(
      { title: "Potholes on the Kodathi road", description: "Several potholes along the road towards Mullur.", category: "pothole", lat: 12.894573, lng: 77.71297, locationSource: "map_pin", observedOn: "2026-09-15" },
      [],
    );
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;

    expect(requests[0].path).toContain("/model/apac.amazon.nova-pro-v1%3A0/converse");
    const tools = (requests[0].body.toolConfig?.tools ?? []) as Array<{ toolSpec?: { name: string }; cachePoint?: unknown }>;
    const toolNames = tools.filter((t) => t.toolSpec).map((t) => t.toolSpec!.name);
    expect(toolNames).toContain("record_claim");
    expect(toolNames).not.toContain("set_case_status");

    expect(inv.engine).toBe("bedrock");
    expect(inv.status).toBe("complete");
    expect(inv.selectedProjectId).toBe("pmgsy-kn03-70");

    const contractor = inv.claims.find((c) => c.field === "contractor");
    expect(contractor?.verification).toBe("verified");

    const tender = inv.claims.find((c) => c.field === "project_id");
    expect(tender?.verification).toBe("unverified");
    expect(tender?.origin).toBe("ai_inference");

    expect(inv.trace.some((t) => t.kind === "denied" && t.tool === "select_project")).toBe(true);
    expect(inv.trace.some((t) => t.kind === "denied" && t.summary.includes("corruption"))).toBe(true);
    expect(inv.summary).not.toMatch(/corrupt/i);
    expect(inv.analysis).toContain("March 2022");
    expect(inv.usage?.inputTokens).toBeGreaterThan(0);

    // Next actions are derived by rules from verified facts, and addressed from the authority directory.
    expect(inv.nextActions.every((a) => a.origin === "rule")).toBe(true);
    expect(inv.nextActions.some((a) => a.type === "rti_request")).toBe(true);
  });
});
