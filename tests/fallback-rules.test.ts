/**
 * With no second model configured (e.g. running locally), a Gemini run that loses its model
 * (daily quota) is finished by the rules planner, which keeps the project Gemini linked by name
 * and records its checked reference facts. The run says so in its trace and model label.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const turns = [
  [{ functionCall: { name: "get_case_report", args: {} } }],
  [{ functionCall: { name: "find_projects_by_name", args: { query: "Koira" } } }],
  [{ functionCall: { name: "select_project", args: { project_id: "pmgsy-bengaluru-rural-kn0204", reasons: ["The report names Koira Hosur road"] } } }],
];
const DAILY = { error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };

let gemini: http.Server;
let calls = 0;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let createCase: typeof import("@/lib/cases").createCase;

beforeAll(async () => {
  gemini = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const turn = turns[calls++];
      if (!turn) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify(DAILY));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: turn }, finishReason: "STOP" }] })}\r\n\r\n`);
    });
  });
  await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-rulesfallback-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "");
  vi.stubEnv("CIVICPROOF_FALLBACK_MODEL", "");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL_ID", "gemini-3-flash-preview");
  vi.stubEnv("GEMINI_ENDPOINT", `http://127.0.0.1:${(gemini.address() as AddressInfo).port}`);
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ createCase } = await import("@/lib/cases"));
});

afterAll(() => new Promise<void>((r) => gemini.close(() => r())));

describe("rules planner takes over a Gemini run", () => {
  it("keeps the project linked by name and records its checked facts", async () => {
    const { caseData } = await createCase(
      { title: "Road breaking up near Koira", description: "Potholes on the Koira Hosur road near Koira village.", category: "road_damage", lat: 13.3034243, lng: 77.641612, locationSource: "map_pin", address: "Koira Hosur road, Devanahalli", observedOn: "2026-09-17" },
      [],
    );
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;
    expect(inv.status).toBe("complete");
    expect(inv.model).toBe("gemini-3-flash-preview → rules planner");
    expect(inv.selectedProjectId).toBe("pmgsy-bengaluru-rural-kn0204");
    expect(inv.matches.find((m) => m.projectId === inv.selectedProjectId)?.linkedBy).toBe("name");
    expect(inv.claims.find((c) => c.field === "project_id")?.verification).toBe("verified");
    expect(inv.summary).toContain("by the road and place names in its record");
    expect(inv.trace.some((t) => t.kind === "note" && t.summary.includes("Finishing with the rules planner"))).toBe(true);
  });
});
