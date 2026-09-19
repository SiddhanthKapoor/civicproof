/**
 * Deterministic post-processing after the planner finishes:
 *  - conflict detection between claims
 *  - computed claims (maintenance / defect-liability window) derived only from verified inputs
 *  - missing-information checklist for the fields a complaint needs
 *  - next actions, addressed from the authority directory (never from model output)
 */
import type { Claim, ClaimField, Determination, MissingItem, NextAction, Verification } from "@/lib/schemas";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { Authority } from "@/lib/corpus";
import { detectConflicts } from "./verifier";
import { labelledDates, parseDates, parseDurationsMonths } from "./text";
import { determine } from "./determination";
import { resolveIdentityFromRecord } from "./identity";
import type { RunContext } from "./context";

/**
 * What not knowing each field blocks. Stated here, deterministically, so the explanation a citizen
 * reads is never model prose (spec item J: every gap says why it matters).
 */
const WHY_IT_MATTERS: Partial<Record<ClaimField, string>> = {
  project_name: "Without the project, none of the contract's obligations can be looked up at all.",
  agency: "Without the executing department, there is no office to send the complaint or the RTI request to.",
  contractor: "Without the contractor named in the work order, there is no party who owes the maintenance obligation.",
  contract_value: "Without the contract value, the scale of the work — and so what was promised — cannot be checked.",
  completion_date: "Without a verified completion date the defect-liability period cannot be computed, so whether the obligation is still open stays UNKNOWN.",
  defect_liability: "Without the defect-liability clause there is no maintenance duration to apply to the completion date.",
  scope: "Without the scope of work it cannot be established that this stretch of road was part of this contract.",
  location_match: "Until one project is established for this spot, any obligation found belongs to a contract that may not cover it.",
};

const KEY_FIELDS: Array<{ field: ClaimField; record: string }> = [
  { field: "project_name", record: "Name of work as per the sanction / work order" },
  { field: "agency", record: "Name of the executing department or division" },
  { field: "contractor", record: "Work order or contract agreement naming the contractor" },
  { field: "contract_value", record: "Contract agreement or work order stating the contract value" },
  { field: "completion_date", record: "Completion certificate or final bill with the date of completion" },
  { field: "defect_liability", record: "Contract clause on the defect liability / maintenance period" },
  { field: "scope", record: "Detailed estimate or bill of quantities describing the scope of work" },
];

function usable(c: Claim) {
  return c.verification === "verified" || c.verification === "partially_verified";
}

function weakest(a: Verification, b: Verification): Verification {
  const order: Verification[] = ["verified", "partially_verified", "unverified", "contradicted", "unknown"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function monthsBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z"), db = new Date(b + "T00:00:00Z");
  return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth()) - (db.getUTCDate() < da.getUTCDate() ? 1 : 0);
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A completion date is only usable when the source says it is the *physical* completion of the
 * works. OMMAS prints both kinds in one cell ("Financial: 27-05-2024 / Physical: 05-03-2022"), and
 * a financial or payment date is a different fact (spec item 18). Returns undefined — i.e. UNKNOWN
 * — rather than guessing when the labels are missing or ambiguous.
 */
const PHYSICAL_WORDS = /\b(physical|actual|completed on|work completion|works completion)\b/g;
const OTHER_COMPLETION_WORDS = /\b(financial|payment|paid|final bill|administrative|closure|sanction|award)\b/g;

/** Which kind of completion a date is labelled as, judged by the *nearest* label on either side. */
function labelKind(before: string, after: string): "physical" | "other" | undefined {
  const nearest = (re: RegExp) => {
    let best = Number.POSITIVE_INFINITY;
    for (const m of before.matchAll(new RegExp(re.source, "gi"))) best = Math.min(best, before.length - (m.index + m[0].length));
    for (const m of after.matchAll(new RegExp(re.source, "gi"))) best = Math.min(best, m.index);
    return best;
  };
  const physical = nearest(PHYSICAL_WORDS);
  const other = nearest(OTHER_COMPLETION_WORDS);
  if (physical === other) return undefined;
  return physical < other ? "physical" : "other";
}

export function physicalCompletionDate(c: Claim): string | undefined {
  const stated = parseDates(c.value ?? "");
  if (!stated.length) return undefined;
  const labelled = labelledDates(`${c.value ?? ""} ${c.text}`).map((x) => ({ ...x, kind: labelKind(x.before, x.after) }));
  const physical = new Set(labelled.filter((x) => x.kind === "physical").map((x) => x.date));
  const other = new Set(labelled.filter((x) => x.kind === "other").map((x) => x.date));
  if (stated.length === 1) {
    // One date: usable unless the source labels that very date as something other than the works.
    const d = stated[0];
    return other.has(d) && !physical.has(d) ? undefined : d;
  }
  // Several dates: only an unambiguous physical label resolves which one is meant.
  const resolved = stated.filter((d) => physical.has(d) && !other.has(d));
  return resolved.length === 1 ? resolved[0] : undefined;
}

/** Computes whether the observation date falls inside the defect-liability period. */
export function maintenanceWindow(claims: Claim[], observedOn: string): Claim | undefined {
  const completion = claims.find((c) => c.field === "completion_date" && usable(c) && physicalCompletionDate(c));
  const dlp = claims.find((c) => c.field === "defect_liability" && usable(c) && c.value && parseDurationsMonths(c.value).length);
  if (!completion || !dlp) return undefined;
  const done = physicalCompletionDate(completion)!;
  const months = parseDurationsMonths(dlp.value!)[0];
  const end = addMonths(done, months);
  const after = monthsBetween(done, observedOn);
  const inside = observedOn >= done && observedOn <= end;
  const before = observedOn < done;
  const text = before
    ? `The issue was observed on ${fmtDate(observedOn)}, before the recorded completion date (${fmtDate(done)}).`
    : inside
      ? `The issue was observed on ${fmtDate(observedOn)}, ${after} month${after === 1 ? "" : "s"} after the recorded completion date (${fmtDate(done)}). The stated defect liability period of ${months} months runs until ${fmtDate(end)}, so the observation falls inside it.`
      : `The issue was observed on ${fmtDate(observedOn)}, after the stated defect liability period of ${months} months ended on ${fmtDate(end)}.`;
  return {
    id: `cl_window_${completion.id}`,
    field: "maintenance_window",
    text,
    value: inside ? `inside:${end}` : before ? "before_completion" : `outside:${end}`,
    evidenceIds: [...completion.evidenceIds, ...dlp.evidenceIds],
    verification: weakest(completion.verification, dlp.verification),
    confidence: Math.min(completion.confidence, dlp.confidence),
    origin: "computed",
    derivedFrom: [completion.id, dlp.id],
    notes: `Computed: completion date + ${months} months = ${end}. Whether a specific defect is covered depends on the contract's terms.`,
  };
}

export function missingChecklist(claims: Claim[], alreadyFlagged: MissingItem[], hasProject: boolean): MissingItem[] {
  const out = [...alreadyFlagged];
  if (!hasProject) {
    if (!out.some((m) => m.field === "project_name"))
      out.unshift({
        field: "project_name",
        label: CLAIM_FIELD_LABELS.project_name,
        reason: "No public-works project in the records CivicProof holds matches this location.",
        whyItMatters: WHY_IT_MATTERS.project_name,
        requestableRecord: "List of road works sanctioned or executed on this stretch in the last five years, with work orders",
      });
    return out.map((m) => ({ ...m, whyItMatters: m.whyItMatters ?? WHY_IT_MATTERS[m.field] }));
  }
  for (const k of KEY_FIELDS) {
    const hasVerified = claims.some((c) => c.field === k.field && c.verification === "verified");
    const hasFields = k.field === "contract_value" ? claims.some((c) => (c.field === "contract_value" || c.field === "sanctioned_cost") && c.verification === "verified") : hasVerified;
    if (hasFields || out.some((m) => m.field === k.field)) continue;
    const partial = claims.find((c) => c.field === k.field && usable(c));
    out.push({
      field: k.field,
      label: CLAIM_FIELD_LABELS[k.field],
      reason: partial
        ? "A source mentions this, but the value could not be confirmed verbatim in an official document."
        : "Not stated in the documents available to CivicProof.",
      whyItMatters: WHY_IT_MATTERS[k.field],
      requestableRecord: k.record,
    });
  }
  // Items the agent flagged carry the same deterministic explanation, keyed by field.
  return out.map((m) => ({ ...m, whyItMatters: m.whyItMatters ?? WHY_IT_MATTERS[m.field] }));
}

export function deriveNextActions(
  claims: Claim[],
  missing: MissingItem[],
  authority: Authority | undefined,
  aiProposals: RunContext["proposedActions"],
  projectOfficer?: string,
  identityEstablished = true,
): NextAction[] {
  const officer = projectOfficer ?? authority?.officer;
  const actions: NextAction[] = [];
  const window = claims.find((c) => c.field === "maintenance_window");
  const contractor = claims.find((c) => c.field === "contractor" && c.verification === "verified");
  const agencyName = authority?.name;

  // This action names a contractor and an office: it must not be raised on an unestablished project.
  if (identityEstablished && window?.value?.startsWith("inside:") && (window.verification === "verified" || window.verification === "partially_verified")) {
    actions.push({
      type: "defect_liability_repair_request",
      title: "Request repair under the defect liability period",
      rationale: `${window.text} Defect liability clauses in public works contracts generally oblige the contractor to rectify defects that appear during the period; the exact obligation depends on this contract's terms. The request goes to the executing agency, which enforces the contract.${authority?.grievance ? ` Send the complaint packet through ${authority.grievance.name}, then record the reference number here.` : ""}`,
      addressedTo: officer ?? (agencyName ? `Executive Engineer, ${agencyName}` : "The executing agency's Executive Engineer"),
      channel: authority?.grievance?.name,
      channelUrl: authority?.grievance?.url,
      channelNote: authority?.grievance?.note,
      basedOnClaimIds: [window.id, ...(window.derivedFrom ?? []), ...(contractor ? [contractor.id] : [])],
      priority: 1,
      origin: "rule",
    });
  }

  // With a repair request, the complaint already goes to the same office through the same channel.
  const repairRequested = actions.some((a) => a.type === "defect_liability_repair_request");
  if (authority?.grievance && !repairRequested) {
    actions.push({
      type: "grievance_portal",
      title: `File the complaint with ${authority.shortName ?? authority.name}`,
      rationale: `Submit the complaint packet through ${authority.grievance.name}, then record the reference number here so the case can be followed up.`,
      channelNote: authority.grievance.note,
      addressedTo: officer ?? authority.name,
      channel: authority.grievance.name,
      channelUrl: authority.grievance.url,
      basedOnClaimIds: claims.filter((c) => c.field === "agency" && usable(c)).map((c) => c.id),
      priority: actions.length ? 2 : 1,
      origin: "rule",
    });
  }

  const requestable = missing.filter((m) => m.requestableRecord);
  if (requestable.length) {
    actions.push({
      type: "rti_request",
      title: "Request the missing records under the RTI Act, 2005",
      rationale: `${requestable.length} fact${requestable.length === 1 ? " is" : "s are"} not established by available records (${requestable
        .map((m) => m.label.toLowerCase())
        .slice(0, 4)
        .join(", ")}). An RTI application to the Public Information Officer can obtain the underlying documents; a reply is due within 30 days.`,
      addressedTo: authority?.rti?.addressee ?? "Public Information Officer of the agency responsible for this road",
      channel: authority?.rti?.portalUrl ? "RTI Online" : "RTI application by post",
      channelUrl: authority?.rti?.portalUrl,
      channelNote: [authority?.rti?.note, authority?.rti?.fee].filter(Boolean).join(" ") || undefined,
      basedOnClaimIds: [],
      priority: actions.length ? 3 : 1,
      origin: "rule",
    });
  }

  for (const p of aiProposals) {
    if (actions.some((a) => a.type === p.type) || (repairRequested && p.type === "grievance_portal")) continue;
    actions.push({ ...p, priority: 4, origin: "ai" });
  }
  return actions.sort((a, b) => a.priority - b.priority);
}

/**
 * Deterministic clean-up of what a model proposed: a "financial completion" date is not the
 * completion of the works, and the reporter's own words are already on the case.
 */
export function normaliseProposals(claims: Claim[]): Claim[] {
  return claims
    .filter((c) => !(c.field === "reported_condition" && c.origin !== "official_record"))
    // The defect-liability window is arithmetic, never an opinion: a model-authored one is dropped
    // outright, so the only window that can exist is the one this file computes (spec item 19).
    .filter((c) => !(c.field === "maintenance_window" && c.origin !== "computed"))
    .map((c) =>
      // A completion date we cannot tie to physical completion is not a completion date. Demoting it
      // to "other" leaves completion UNKNOWN and lets the gap checklist ask for the real record.
      c.field === "completion_date" && !physicalCompletionDate(c) ? { ...c, field: "other" as const } : c,
    );
}

export function finalizeClaims(ctx: RunContext) {
  const { claims: checked, conflicts } = detectConflicts(normaliseProposals(ctx.claims));
  // normaliseProposals has already dropped any model-authored window, so this is the only one.
  const window = maintenanceWindow(checked, ctx.caseData.observedOn);
  const all = window ? [...checked, window] : checked;
  const missing = missingChecklist(all, ctx.missing, Boolean(ctx.selectedProjectId));
  const project = ctx.selectedProjectId ? ctx.corpus.getProject(ctx.selectedProjectId) : undefined;
  const authority = ctx.corpus.getAuthority(project?.agencyId);
  // Identity first: an identifier resolved up front wins; otherwise the project the location
  // suggested is only established once its work identifier is confirmed verbatim in its own records.
  // Everything downstream — the actions, the packet, the case status — depends on the answer.
  const selected = ctx.matches.find((m) => m.projectId === ctx.selectedProjectId);
  const identity: Determination["identity"] =
    ctx.identity ??
    resolveIdentityFromRecord({ project, claims: all, evidence: ctx.evidence, corpus: ctx.corpus, linkedBy: selected?.linkedBy });

  const nextActions = deriveNextActions(all, missing, authority, ctx.proposedActions, project?.officer, identity.value === "VERIFIED");

  const determination = determine({
    identity,
    window,
    claims: all,
    evidence: ctx.evidence,
    project,
    category: ctx.caseData.category,
    corpus: ctx.corpus,
    photoCount: ctx.caseData.photos.length,
    observation: ctx.photoObservation,
    sufficiency: ctx.photoSufficiency,
    today: new Date().toISOString().slice(0, 10),
    completeness: {
      have: KEY_FIELDS.filter((k) => all.some((c) => c.field === k.field && usable(c))).length,
      of: KEY_FIELDS.length,
    },
  });
  return { claims: all, conflicts, missing, nextActions, determination };
}
