/**
 * Deterministic post-processing after the planner finishes:
 *  - conflict detection between claims
 *  - computed claims (maintenance / defect-liability window) derived only from verified inputs
 *  - missing-information checklist for the fields a complaint needs
 *  - next actions, addressed from the authority directory (never from model output)
 */
import type { Claim, ClaimField, MissingItem, NextAction, Verification } from "@/lib/schemas";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { Authority } from "@/lib/corpus";
import { detectConflicts } from "./verifier";
import { parseDates, parseDurationsMonths } from "./text";
import type { RunContext } from "./context";

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

/** Computes whether the observation date falls inside the defect-liability period. */
export function maintenanceWindow(claims: Claim[], observedOn: string): Claim | undefined {
  const completion = claims.find((c) => c.field === "completion_date" && usable(c) && c.value && parseDates(c.value).length);
  const dlp = claims.find((c) => c.field === "defect_liability" && usable(c) && c.value && parseDurationsMonths(c.value).length);
  if (!completion || !dlp) return undefined;
  const done = parseDates(completion.value!)[0];
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
        reason: "No public-works project in the records corpus matches this location.",
        requestableRecord: "List of road works sanctioned or executed on this stretch in the last five years, with work orders",
      });
    return out;
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
      requestableRecord: k.record,
    });
  }
  return out;
}

export function deriveNextActions(
  claims: Claim[],
  missing: MissingItem[],
  authority: Authority | undefined,
  aiProposals: RunContext["proposedActions"],
  projectOfficer?: string,
): NextAction[] {
  const officer = projectOfficer ?? authority?.officer;
  const actions: NextAction[] = [];
  const window = claims.find((c) => c.field === "maintenance_window");
  const contractor = claims.find((c) => c.field === "contractor" && c.verification === "verified");
  const agencyName = authority?.name;

  if (window?.value?.startsWith("inside:") && (window.verification === "verified" || window.verification === "partially_verified")) {
    actions.push({
      type: "defect_liability_repair_request",
      title: "Request repair under the defect liability period",
      rationale: `${window.text} Defect liability clauses in public works contracts generally oblige the contractor to rectify defects that appear during the period; the exact obligation depends on this contract's terms. The request goes to the executing agency, which enforces the contract.`,
      addressedTo: officer ?? (agencyName ? `Executive Engineer, ${agencyName}` : "The executing agency's Executive Engineer"),
      channel: authority?.grievance?.name,
      channelUrl: authority?.grievance?.url,
      channelNote: authority?.grievance?.note,
      basedOnClaimIds: [window.id, ...(window.derivedFrom ?? []), ...(contractor ? [contractor.id] : [])],
      priority: 1,
      origin: "rule",
    });
  }

  if (authority?.grievance) {
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
    if (actions.some((a) => a.type === p.type)) continue;
    actions.push({ ...p, priority: 4, origin: "ai" });
  }
  return actions.sort((a, b) => a.priority - b.priority);
}

export function finalizeClaims(ctx: RunContext) {
  const { claims, conflicts } = detectConflicts(ctx.claims);
  const window = maintenanceWindow(claims, ctx.caseData.observedOn);
  const all = window ? [...claims, window] : claims;
  const missing = missingChecklist(all, ctx.missing, Boolean(ctx.selectedProjectId));
  const project = ctx.selectedProjectId ? ctx.corpus.getProject(ctx.selectedProjectId) : undefined;
  const authority = ctx.corpus.getAuthority(project?.agencyId);
  const nextActions = deriveNextActions(all, missing, authority, ctx.proposedActions, project?.officer);
  return { claims: all, conflicts, missing, nextActions };
}
