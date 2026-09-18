// CivicProof · authorization policy for actions on a case
//
// Evaluated by the API (lib/authz.ts) before any state change.
//   principal : Public::"anonymous" | Reporter::"<case id>" (holds the owner key) | Agent::"investigator"
//   action    : ViewCase | CreateCase | StartInvestigation | RecordSubmission | RecordResponse
//               | AddNote | EditPacket | AddEvidence | ViewPrivateDocument | ViewPrivateDetails | ChangeStatus
//   resource  : Case::"<case id>"
//   context   : { is_owner, to_status, runs_for_case, max_runs_per_case, runs_today, max_runs_per_day }

@id("public-read-and-report")
permit (principal, action in [Action::"ViewCase", Action::"CreateCase"], resource);

// Investigating only reads public records, so anyone may start one, within budget.
@id("investigate-within-budget")
permit (principal, action == Action::"StartInvestigation", resource)
when {
  context.runs_for_case < context.max_runs_per_case &&
  context.runs_today < context.max_runs_per_day
};

// Only the person who filed the report records what happened in the real world.
@id("owner-records-real-world-actions")
permit (
  principal is Reporter,
  action in [
    Action::"RecordSubmission",
    Action::"RecordResponse",
    Action::"AddNote",
    Action::"EditPacket",
    Action::"AddEvidence",
    Action::"ViewPrivateDocument",
    Action::"ViewPrivateDetails",
    Action::"ChangeStatus"
  ],
  resource
)
when { context.is_owner };

// The agent may move a case through investigation states and nowhere else.
@id("agent-investigation-states")
permit (principal == Agent::"investigator", action == Action::"ChangeStatus", resource)
when { ["investigating", "evidence_found", "case_prepared"].contains(context.to_status) };

// Nobody except the reporter can declare a case submitted, answered, resolved or closed.
// This holds even if a future policy above is written too broadly.
@id("only-reporter-closes-the-loop")
forbid (principal, action == Action::"ChangeStatus", resource)
when { ["submitted", "awaiting_response", "resolved", "closed"].contains(context.to_status) }
unless { principal is Reporter && context.is_owner };
