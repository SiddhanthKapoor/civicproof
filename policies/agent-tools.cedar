// CivicProof · authorization policy for the investigation agent
//
// Evaluated by the Strands Agents CedarAuthorization intervention before EVERY tool call
// the model makes (Claude on Bedrock or the rules planner).
//   principal : Agent::"investigator"
//   action    : Action::"<tool name>"
//   context   : { input: <tool arguments>, session: { call_count, candidate_ids, ... } }
// Anything not permitted here is denied, and the denial is shown in the case trace.

// Research tools only read the public-records corpus.
@id("research-tools")
permit (
  principal == Agent::"investigator",
  action in [
    Action::"get_case_report",
    Action::"find_projects_near",
    Action::"list_project_documents",
    Action::"search_documents",
    Action::"read_document_page"
  ],
  resource
);

// Keep project search local to the report: no radius above 2 km.
@id("bounded-radius")
forbid (principal, action == Action::"find_projects_near", resource)
when { context.input has radius_m && context.input.radius_m > 2000 };

// The agent may only link a case to a project that the location search actually returned.
@id("select-only-located-candidates")
permit (principal == Agent::"investigator", action == Action::"select_project", resource)
when { context.session.candidate_ids.contains(context.input.project_id) };

// Findings are proposals: the grounding verifier decides what they are worth.
@id("record-findings")
permit (
  principal == Agent::"investigator",
  action in [
    Action::"record_claim",
    Action::"flag_missing",
    Action::"propose_next_action",
    Action::"finish"
  ],
  resource
);

// A claim attributed to an official record must cite one.
@id("official-claims-need-citations")
forbid (principal, action == Action::"record_claim", resource)
when {
  context.input.origin == "official_record" &&
  (!(context.input has citations) || context.input.citations.isEmpty())
};

// Per-run budgets so a looping model cannot run up the Bedrock bill.
@id("reading-budget")
forbid (principal, action == Action::"read_document_page", resource)
when { context.session.call_count > 24 };

@id("claim-budget")
forbid (principal, action == Action::"record_claim", resource)
when { context.session.call_count > 30 };

@id("search-budget")
forbid (principal, action == Action::"search_documents", resource)
when { context.session.call_count > 16 };
