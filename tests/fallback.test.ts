/**
 * Gemini → Amazon Bedrock fallback. A stand-in Gemini works for three turns, then answers with its
 * free-tier daily quota error; a stand-in Bedrock (Converse, as Amazon Nova) picks the run up from
 * the shared context: same selected project, facts verified by the same verifier.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PAGE = "ommas-slr-pmgsy3-bangalore-urban";
const geminiTurns: Array<Array<{ functionCall: { name: string; args: Record<string, unknown> } }>> = [
  [{ functionCall: { name: "get_case_report", args: {} } }],
  [{ functionCall: { name: "find_projects_near", args: { radius_m: 750 } } }],
  [{ functionCall: { name: "select_project", args: { project_id: "pmgsy-kn03-70", reasons: ["On the alignment"] } } }],
];
const DAILY_QUOTA = {
  error: {
    code: 429,
    message: "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
    status: "RESOURCE_EXHAUSTED",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }],
  },
};
type Block = { text?: string; toolUse?: { toolUseId: string; name: string; input: unknown } };
const novaTurns: Block[][] = [
  [{ toolUse: { toolUseId: "n1", name: "read_document_page", input: { doc_id: PAGE, page: 1 } } }],
  [
    {
      toolUse: {
        toolUseId: "n2",
        name: "record_claim",
        input: {
          field: "contractor",
          text: "OMMAS names Venkatarama Reddy .M as the contractor.",
          value: "Venkatarama Reddy .M",
          origin: "official_record",
          citations: [{ doc_id: PAGE, page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89 Maintenance Regular PMGSY Venkatarama Reddy .M [29 Jun 2020]" }],
        },
      },
    },
  ],
  [{ toolUse: { toolUseId: "n3", name: "finish", input: { summary: "The report lies on PMGSY road KN03-70; OMMAS names the contractor." } } }],
  [{ text: "Done." }],
];

let gemini: http.Server;
let bedrock: http2.Http2Server;
let geminiCalls = 0;
const novaRequests: Array<{ path: string; body: { messages: Array<{ role: string; content: Array<{ text?: string }> }> } }> = [];
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let createCase: typeof import("@/lib/cases").createCase;

beforeAll(async () => {
  gemini = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const turn = geminiTurns[geminiCalls++];
      if (!turn) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify(DAILY_QUOTA));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: turn }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } })}\r\n\r\n`);
    });
  });
  bedrock = http2.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      novaRequests.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
      const turn = novaTurns[Math.min(novaRequests.length - 1, novaTurns.length - 1)];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          output: { message: { role: "assistant", content: turn } },
          stopReason: turn.some((b) => b.toolUse) ? "tool_use" : "end_turn",
          usage: { inputTokens: 800, outputTokens: 30, totalTokens: 830 },
          metrics: { latencyMs: 5 },
        }),
      );
    });
  });
  await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => bedrock.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-fallback-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-3-flash-preview");
  vi.stubEnv("GEMINI_ENDPOINT", `http://127.0.0.1:${(gemini.address() as AddressInfo).port}`);
  vi.stubEnv("CIVICPROOF_FALLBACK_MODEL", "apac.amazon.nova-pro-v1:0");
  vi.stubEnv("BEDROCK_ENDPOINT", `http://127.0.0.1:${(bedrock.address() as AddressInfo).port}`);
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ createCase } = await import("@/lib/cases"));
});

afterAll(async () => {
  await new Promise<void>((r) => gemini.close(() => r()));
  await new Promise<void>((r) => bedrock.close(() => r()));
});

describe("Gemini to Amazon Bedrock fallback", () => {
  it("continues on Amazon Nova when Gemini's daily quota runs out, keeping the work done", async () => {
    const { caseData } = await createCase(
      { title: "Potholes on the Kodathi road", description: "Several potholes along the road towards Mullur.", category: "pothole", lat: 12.894573, lng: 77.71297, locationSource: "map_pin", observedOn: "2026-09-15" },
      [],
    );
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;

    expect(geminiCalls).toBe(4); // three turns, then the daily-quota error (not retried)
    expect(novaRequests[0].path).toContain("/model/apac.amazon.nova-pro-v1%3A0/converse");
    const handover = novaRequests[0].body.messages[0].content.map((b) => b.text ?? "").join("\n");
    expect(handover).toContain("Selected project: pmgsy-kn03-70");

    expect(inv.status).toBe("complete");
    expect(inv.engine).toBe("gemini");
    expect(inv.model).toBe("gemini-3-flash-preview → apac.amazon.nova-pro-v1:0");
    expect(inv.selectedProjectId).toBe("pmgsy-kn03-70");
    expect(inv.claims.find((c) => c.field === "contractor")?.verification).toBe("verified");
    expect(inv.trace.some((t) => t.kind === "note" && t.summary.includes("Continuing on Amazon Bedrock"))).toBe(true);
  });
});
