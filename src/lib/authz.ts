/**
 * Cedar authorization for actions on a case (policies/case-actions.cedar).
 * Uses the same Cedar engine (cedar-wasm) that governs the agent's tool calls.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAuthorized, policySetTextToParts } from "@cedar-policy/cedar-wasm/nodejs";
import type { CaseStatus } from "@/lib/schemas";

export type CaseAction =
  | "ViewCase"
  | "CreateCase"
  | "StartInvestigation"
  | "RecordSubmission"
  | "RecordResponse"
  | "AddNote"
  | "EditPacket"
  | "AddEvidence"
  | "ViewPrivateDocument"
  | "ViewPrivateDetails"
  | "ChangeStatus";

export type Principal =
  | { type: "Public"; id: "anonymous" }
  | { type: "Reporter"; id: string }
  | { type: "Agent"; id: "investigator" };

export interface CaseActionContext {
  is_owner?: boolean;
  to_status?: CaseStatus;
  runs_for_case?: number;
  max_runs_per_case?: number;
  runs_today?: number;
  max_runs_per_day?: number;
}

let policies: Record<string, string> | undefined;
/** The policy file split into policies keyed by their @id, so decisions name the policy that made them. */
function loadPolicies(): Record<string, string> {
  if (policies) return policies;
  const text = readFileSync(path.join(process.cwd(), "policies", "case-actions.cedar"), "utf8");
  const parts = policySetTextToParts(text);
  if (parts.type === "failure") throw new Error(`case-actions.cedar: ${parts.errors.map((e) => e.message).join("; ")}`);
  policies = Object.fromEntries(parts.policies.map((p, i) => [/@id\("([^"]+)"\)/.exec(p)?.[1] ?? `policy${i}`, p]));
  return policies;
}

export interface Decision {
  allowed: boolean;
  /** Ids of the policies that determined the decision (e.g. "only-reporter-closes-the-loop"). */
  policies: string[];
  errors: string[];
}

export function authorize(principal: Principal, action: CaseAction, caseId: string, ctx: CaseActionContext = {}): Decision {
  const context = {
    is_owner: ctx.is_owner ?? false,
    to_status: ctx.to_status ?? "",
    runs_for_case: ctx.runs_for_case ?? 0,
    max_runs_per_case: ctx.max_runs_per_case ?? 0,
    runs_today: ctx.runs_today ?? 0,
    max_runs_per_day: ctx.max_runs_per_day ?? 0,
  };
  const result = isAuthorized({
    principal: { type: principal.type, id: principal.id },
    action: { type: "Action", id: action },
    resource: { type: "Case", id: caseId },
    context,
    policies: { staticPolicies: loadPolicies() },
    entities: [],
  });
  if (result.type === "failure") {
    return { allowed: false, policies: [], errors: result.errors.map((e) => e.message) };
  }
  return {
    allowed: result.response.decision === "allow",
    policies: result.response.diagnostics.reason,
    errors: result.response.diagnostics.errors.map((e) => e.error.message),
  };
}
