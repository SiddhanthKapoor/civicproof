import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isAuthorized } from "@cedar-policy/cedar-wasm/nodejs";
import { authorize } from "@/lib/authz";

describe("case-actions.cedar", () => {
  const budget = { runs_for_case: 0, max_runs_per_case: 5, runs_today: 0, max_runs_per_day: 100 };

  it("lets anyone view, report and investigate within budget", () => {
    expect(authorize({ type: "Public", id: "anonymous" }, "ViewCase", "CP-1").allowed).toBe(true);
    expect(authorize({ type: "Public", id: "anonymous" }, "StartInvestigation", "CP-1", budget).allowed).toBe(true);
  });

  it("stops investigations when a budget is exhausted", () => {
    expect(authorize({ type: "Public", id: "anonymous" }, "StartInvestigation", "CP-1", { ...budget, runs_for_case: 5 }).allowed).toBe(false);
    expect(authorize({ type: "Public", id: "anonymous" }, "StartInvestigation", "CP-1", { ...budget, runs_today: 100 }).allowed).toBe(false);
  });

  it("never lets the agent mark a case submitted or resolved", () => {
    // Everything from "submitted" onwards is a fact about the world outside this system — whether
    // it was filed, whether anyone replied, whether anyone came to look. CivicProof cannot observe
    // any of it, so it may not assert any of it.
    for (const to of [
      "submitted",
      "awaiting_response",
      "response_received",
      "inspection_reported",
      "action_reported",
      "resolved",
      "disputed",
      "closed",
    ] as const) {
      const d = authorize({ type: "Agent", id: "investigator" }, "ChangeStatus", "CP-1", { to_status: to });
      expect(d.allowed).toBe(false);
    }
    expect(authorize({ type: "Agent", id: "investigator" }, "ChangeStatus", "CP-1", { to_status: "evidence_found" }).allowed).toBe(true);
  });

  it("requires the owner key for real-world actions", () => {
    expect(authorize({ type: "Public", id: "anonymous" }, "RecordSubmission", "CP-1").allowed).toBe(false);
    expect(authorize({ type: "Reporter", id: "CP-1" }, "RecordSubmission", "CP-1", { is_owner: false }).allowed).toBe(false);
    expect(authorize({ type: "Reporter", id: "CP-1" }, "RecordSubmission", "CP-1", { is_owner: true }).allowed).toBe(true);
    const d = authorize({ type: "Reporter", id: "CP-1" }, "ChangeStatus", "CP-1", { is_owner: true, to_status: "resolved" });
    expect(d.allowed).toBe(true);
  });
});

describe("agent-tools.cedar", () => {
  const policies = readFileSync("policies/agent-tools.cedar", "utf8");
  const check = (action: string, input: Record<string, unknown>, session: Record<string, unknown> = {}) => {
    const r = isAuthorized({
      principal: { type: "Agent", id: "investigator" },
      action: { type: "Action", id: action },
      resource: { type: "Resource", id: "agent" },
      context: { input, session: { hour_utc: 1, call_count: 1, candidate_ids: [], ...session } } as never,
      policies: { staticPolicies: policies },
      entities: [],
    });
    if (r.type === "failure") throw new Error(r.errors.map((e) => e.message).join(","));
    return r.response.decision;
  };

  it("parses and allows research", () => {
    expect(check("search_documents", { query: "contractor" })).toBe("allow");
    expect(check("find_projects_near", { radius_m: 800 })).toBe("allow");
  });
  it("bounds the search radius", () => {
    expect(check("find_projects_near", { radius_m: 50000 })).toBe("deny");
  });
  it("only allows selecting located candidates", () => {
    expect(check("select_project", { project_id: "p1" }, { candidate_ids: ["p1"] })).toBe("allow");
    expect(check("select_project", { project_id: "p9" }, { candidate_ids: ["p1"] })).toBe("deny");
  });
  it("requires citations for official-record claims", () => {
    expect(check("record_claim", { origin: "official_record", citations: [] })).toBe("deny");
    expect(check("record_claim", { origin: "official_record", citations: [{ doc_id: "d", page: 1, quote: "q" }] })).toBe("allow");
    expect(check("record_claim", { origin: "ai_inference", citations: [] })).toBe("allow");
  });
  it("denies unknown tools by default", () => {
    expect(check("shell", { cmd: "rm -rf /" })).toBe("deny");
    expect(check("set_case_status", { status: "submitted" })).toBe("deny");
  });
  it("lets the agent fetch only public records its own search returned, within a budget", () => {
    const found = { found_record_ids: ["kppp-tender-1"], live_fetches: 0, live_searches: 0 };
    expect(check("search_public_records", { query: "Mullur road" }, found)).toBe("allow");
    expect(check("search_public_records", { query: "Mullur road" }, { ...found, live_searches: 6 })).toBe("deny");
    expect(check("fetch_public_record", { record_id: "kppp-tender-1" }, found)).toBe("allow");
    expect(check("fetch_public_record", { record_id: "kppp-tender-999" }, found)).toBe("deny");
    expect(check("fetch_public_record", { record_id: "kppp-tender-1" }, { ...found, live_fetches: 6 })).toBe("deny");
  });
  it("enforces per-run budgets", () => {
    expect(check("read_document_page", { doc_id: "d", page: 1 }, { call_count: 25 })).toBe("deny");
  });
});
