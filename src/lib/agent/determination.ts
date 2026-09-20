/**
 * The four determinations, derived by plain code from verified claims — never by a model.
 *
 * They are kept independent on purpose. A defect-liability period that is still open is a fact
 * about a contract; a defect visible in a photograph is a fact about a road; whether the two are
 * related is a third question. Collapsing them into one verdict is how "the period is open" turns
 * into "the contractor is at fault", which this product must never assert (spec items A, F).
 */
import type { Case, Claim, Determination, Evidence } from "@/lib/schemas";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { Corpus, Project } from "@/lib/corpus";
import { fmtDate } from "./text";

/** What the photo call reported, when a vision model ran. */
export interface PhotoObservation {
  infrastructure_damage_visible: boolean;
  visible_issues: string[];
  description: string;
  severity: "minor" | "moderate" | "severe" | "unclear";
}

/** The deterministic part of the sufficiency gate; a model flag never overrides a failed check. */
export interface PhotoSufficiency {
  sufficient: boolean;
  reasons: string[];
  recapture?: string;
}

/**
 * The deterministic gate on a photograph, computed in code before any model sees it.
 *
 * Scope, stated plainly so the claim is not overread: this checks **technical usability** — that a
 * file is present, that it decoded to real dimensions, that it clears a resolution floor, and that
 * it is not trivially small. It is **not** blur, exposure or content analysis, and it does not
 * judge whether the right thing was photographed. What it guarantees is the direction of the gate:
 * a photograph this check rejects can never be talked into sufficiency by a model.
 */
export const MIN_PHOTO_EDGE_PX = 640;
export const MIN_PHOTO_BYTES = 8 * 1024;

export function photoSufficiency(photo: { width?: number; height?: number; bytes: number } | undefined): PhotoSufficiency {
  if (!photo) {
    return { sufficient: false, reasons: ["no photograph was submitted"], recapture: "Add a photograph of the damage, taken at the spot." };
  }
  const reasons: string[] = [];
  const short = photo.width && photo.height ? Math.min(photo.width, photo.height) : undefined;
  if (short === undefined) {
    reasons.push("the image's dimensions could not be read");
  } else if (short < MIN_PHOTO_EDGE_PX) {
    reasons.push(`the image is ${short}px on its short edge, below the ${MIN_PHOTO_EDGE_PX}px needed to show surface detail`);
  }
  if (photo.bytes < MIN_PHOTO_BYTES) {
    reasons.push(`the file is ${Math.round(photo.bytes / 1024)}KB, too small to carry usable detail`);
  }
  return reasons.length
    ? { sufficient: false, reasons, recapture: "Take the photograph again, closer to the damage and at your camera's normal quality." }
    : { sufficient: true, reasons: [] };
}

const usable = (c: Claim) => c.verification === "verified" || c.verification === "partially_verified";

// ---------------------------------------------------------------------------
// Contractual status — wraps the computed window; the arithmetic lives in finalize.ts
// ---------------------------------------------------------------------------

/**
 * ACTIVE or EXPIRED is judged against today, because that is what decides whether the obligation
 * can still be relied on. Whether the *observation* fell inside the window is a separate fact and
 * is carried alongside, because that is what a complaint argues.
 */
export function contractualStatus(window: Claim | undefined, claims: Claim[], today: string): Determination["contractualStatus"] {
  const completion = claims.find((c) => c.field === "completion_date" && usable(c));
  const dlp = claims.find((c) => c.field === "defect_liability" && usable(c));

  if (!window) {
    const reason = !completion && !dlp
      ? "Neither a completion date nor a defect-liability period is established by the records, so the obligation cannot be placed in time."
      : !completion
        ? "The records state a defect-liability period but not a verified completion date, so the period cannot be placed in time."
        : "The records state a completion date but no defect-liability period, so there is no duration to apply.";
    return { value: "UNKNOWN", reason, basedOnClaimIds: [completion?.id, dlp?.id].filter((x): x is string => Boolean(x)) };
  }
  const basedOnClaimIds = window.derivedFrom ?? [];
  if (window.verification === "contradicted") {
    return { value: "UNKNOWN", reason: "The records disagree about the dates this period is computed from, so its status is not established.", basedOnClaimIds };
  }
  if (window.value === "before_completion") {
    return { value: "UNKNOWN", reason: "The issue was observed before the recorded completion date, so the defect-liability period had not begun.", basedOnClaimIds };
  }
  const end = window.value?.startsWith("inside:") ? window.value.slice(7) : window.value?.startsWith("outside:") ? window.value.slice(8) : undefined;
  if (!end) {
    return { value: "UNKNOWN", reason: "The defect-liability period could not be computed from the records.", basedOnClaimIds };
  }
  const observationInsideWindow = window.value!.startsWith("inside:");
  return end >= today
    ? { value: "ACTIVE", windowEnd: end, observationInsideWindow, reason: `The defect-liability period computed from the cited dates runs until ${end}, which is not yet past.`, basedOnClaimIds }
    : { value: "EXPIRED", windowEnd: end, observationInsideWindow, reason: `The defect-liability period computed from the cited dates ended on ${end}.`, basedOnClaimIds };
}

// ---------------------------------------------------------------------------
// Field condition — what the photograph shows, and nothing about why
// ---------------------------------------------------------------------------

export function fieldCondition(
  photoCount: number,
  observation: PhotoObservation | undefined,
  sufficiency: PhotoSufficiency | undefined,
): Determination["fieldCondition"] {
  if (photoCount === 0) {
    return { value: "INSUFFICIENT_EVIDENCE", reason: "No photograph was submitted with this report, so the condition on the ground has not been assessed." };
  }
  // A deterministic check that failed is final: a model's opinion cannot overrule it.
  if (sufficiency && !sufficiency.sufficient) {
    return {
      value: "INSUFFICIENT_EVIDENCE",
      reason: `The photograph is not sufficient to assess the condition: ${sufficiency.reasons.join("; ")}.`,
      ...(sufficiency.recapture ? { recapture: sufficiency.recapture } : {}),
    };
  }
  if (!observation) {
    return { value: "INSUFFICIENT_EVIDENCE", reason: "The photograph was not analysed on this run, so the condition on the ground has not been assessed." };
  }
  if (observation.severity === "unclear") {
    return { value: "HUMAN_REVIEW", reason: "The photograph was analysed but what it shows is unclear, so a person should look at it." };
  }
  return observation.infrastructure_damage_visible
    ? { value: "DEFECT_OBSERVED", reason: `Damage is visible in the photograph: ${observation.visible_issues.join(", ") || observation.description}.` }
    : { value: "NO_DEFECT_OBSERVED", reason: "The photograph was analysed and does not show damage to public infrastructure." };
}

// ---------------------------------------------------------------------------
// Scope relationship — only from scope evidence that exists in the project's bundle
// ---------------------------------------------------------------------------

const SCOPE_FIELDS: Array<Claim["field"]> = ["scope", "roads_covered"];

/**
 * POTENTIALLY_RELATED requires a verified scope claim whose citation resolves inside *this
 * project's* evidence bundle — the document id must belong to the project and the page must exist.
 * That is checked here, in code, rather than taken from what a model said it cited.
 */
export function scopeRelationship(
  identity: Determination["identity"]["value"],
  project: Project | undefined,
  category: Case["category"],
  claims: Claim[],
  evidence: Evidence[],
  corpus: Pick<Corpus, "getPage">,
): Determination["scopeRelationship"] {
  if (identity !== "VERIFIED" || !project) {
    return { value: "UNKNOWN", reason: "No project is established for this location, so nothing can be said about scope.", basedOnClaimIds: [] };
  }
  const bundle = new Set(project.documents);
  const grounded = claims.filter(
    (c) =>
      SCOPE_FIELDS.includes(c.field) &&
      c.verification === "verified" &&
      c.evidenceIds.some((id) => {
        const e = evidence.find((x) => x.id === id);
        return Boolean(e && bundle.has(e.docId) && e.page !== undefined && corpus.getPage(e.docId, e.page) !== undefined);
      }),
  );
  if (!grounded.length) {
    return {
      value: "UNKNOWN",
      reason: "The project's records on file do not describe the scope of work, so whether this location falls within it is not established.",
      basedOnClaimIds: [],
    };
  }
  const basedOnClaimIds = grounded.map((c) => c.id);
  if (!project.categories.includes(category)) {
    return {
      value: "NOT_ESTABLISHED",
      reason: `The project's recorded scope does not cover work of this kind, so the reported issue is not connected to it by the records.`,
      basedOnClaimIds,
    };
  }
  return {
    value: "POTENTIALLY_RELATED",
    reason: "The project's recorded scope covers work of this kind on this road. Whether this particular defect arises from that work is not established by the records.",
    basedOnClaimIds,
  };
}

// ---------------------------------------------------------------------------
// Overall — a total, ordered table over the three determinations
// ---------------------------------------------------------------------------

type Axes = {
  identity: Determination["identity"]["value"];
  contractual: Determination["contractualStatus"]["value"];
  field: Determination["fieldCondition"]["value"];
  scope: Determination["scopeRelationship"]["value"];
};

/**
 * Ordered rules, applied first-match. Total over every combination of the axes: see
 * tests/determination.test.ts, which enumerates all of them.
 */
const OVERALL_RULES: Array<{ when: (a: Axes) => boolean; value: Determination["overall"]["value"]; reason: string }> = [
  {
    when: (a) => a.identity !== "VERIFIED",
    value: "UNVERIFIED",
    reason: "The project this report concerns is not established, so nothing further has been assessed.",
  },
  {
    when: (a) => a.field === "HUMAN_REVIEW",
    value: "UNKNOWN",
    reason: "What the photograph shows is unclear, so the condition on the ground is not established.",
  },
  {
    when: (a) => a.field === "INSUFFICIENT_EVIDENCE",
    value: "UNKNOWN",
    reason: "The condition on the ground has not been established from the evidence submitted.",
  },
  {
    when: (a) => a.contractual === "UNKNOWN",
    value: "UNKNOWN",
    reason: "The defect-liability period is not established by the records, so no contractual question can be raised.",
  },
  {
    when: (a) => a.scope !== "POTENTIALLY_RELATED",
    value: "UNKNOWN",
    reason: "The relationship between the reported issue and the project's recorded scope is not established.",
  },
  {
    when: (a) => a.field === "NO_DEFECT_OBSERVED",
    value: "SUPPORTED",
    reason: "The records establish the project and its obligations, and the photograph does not show damage.",
  },
  {
    when: (a) => a.contractual === "EXPIRED",
    value: "SUPPORTED",
    reason: "The records establish the project, the defect observed, and that the defect-liability period has ended.",
  },
  {
    when: (a) => a.contractual === "ACTIVE" && a.field === "DEFECT_OBSERVED" && a.scope === "POTENTIALLY_RELATED",
    value: "POTENTIAL_ISSUE",
    reason: "A defect is visible at a location the records place inside a project whose defect-liability period is still open. The available evidence supports treating this as a potential project/maintenance issue requiring human/authority review. The evidence does not establish who is responsible for the defect.",
  },
];

export function overallState(axes: Axes): Determination["overall"] {
  const hit = OVERALL_RULES.find((r) => r.when(axes));
  // Unreachable: the rules above are exhaustive over the axes (proved by the test).
  return hit ? { value: hit.value, reason: hit.reason } : { value: "UNKNOWN", reason: "The evidence does not establish an outcome." };
}

// ---------------------------------------------------------------------------

export function determine(input: {
  identity: Determination["identity"];
  window: Claim | undefined;
  claims: Claim[];
  evidence: Evidence[];
  project: Project | undefined;
  category: Case["category"];
  corpus: Pick<Corpus, "getPage">;
  photoCount: number;
  observation?: PhotoObservation;
  sufficiency?: PhotoSufficiency;
  today: string;
  completeness: Determination["completeness"];
}): Determination {
  // A contract belongs to a project. Until the project is established, its window says nothing
  // about this report, so it is not presented as ACTIVE or EXPIRED (spec item F).
  const computed = contractualStatus(input.window, input.claims, input.today);
  const contractual: Determination["contractualStatus"] =
    input.identity.value === "VERIFIED"
      ? computed
      : {
          value: "UNKNOWN",
          reason:
            "A defect-liability period was computed for the project suggested by the location, but that project's identity is not established, so it says nothing about this report.",
          basedOnClaimIds: computed.basedOnClaimIds,
        };
  const field = fieldCondition(input.photoCount, input.observation, input.sufficiency);
  const scope = scopeRelationship(input.identity.value, input.project, input.category, input.claims, input.evidence, input.corpus);
  const overall = overallState({ identity: input.identity.value, contractual: contractual.value, field: field.value, scope: scope.value });
  return {
    identity: input.identity,
    contractualStatus: contractual,
    fieldCondition: field,
    scopeRelationship: scope,
    overall,
    // A person is asked to look only where a person is what actually settles it: an identifier that
    // several projects share, records that disagree, a photograph too unclear to read, or a defect
    // inside an open maintenance period. A record that is simply absent is deliberately NOT here —
    // that is answered by requesting the record, which is already a next action, and routing it to
    // "human review" would make the flag the generic escape hatch it is meant not to be.
    requiresHumanReview:
      overall.value === "POTENTIAL_ISSUE" ||
      field.value === "HUMAN_REVIEW" ||
      input.identity.value === "CODE_MATCHES_MULTIPLE_PROJECTS" ||
      input.claims.some((c) => c.verification === "contradicted"),
    completeness: input.completeness,
  };
}

/**
 * Why a person is being asked to look, and what would settle it — one entry per live trigger, in
 * the same order `requiresHumanReview` tests them. Every string is written here, in code: none of
 * this is model output, and none of it asserts cause, fault or liability.
 */
export function humanReviewReasons(d: Determination, claims: Claim[]): Array<{ why: string; resolvedBy: string }> {
  const out: Array<{ why: string; resolvedBy: string }> = [];
  if (d.identity.value === "CODE_MATCHES_MULTIPLE_PROJECTS") {
    const n = d.identity.candidateProjectIds?.length ?? 0;
    out.push({
      why: `The work number on this report is carried by ${n} project${n === 1 ? "" : "s"} in the records, so which contract covers this spot is not settled.`,
      resolvedBy: "Someone who knows the site chooses the right project from the candidates listed on this page.",
    });
  }
  const fields = [...new Set(claims.filter((c) => c.verification === "contradicted").map((c) => c.field))];
  if (fields.length) {
    out.push({
      why: `Official records disagree on ${fields.map((f) => CLAIM_FIELD_LABELS[f].toLowerCase()).join(", ")}. Both values are shown; neither has been chosen.`,
      resolvedBy: "A reviewer reads the cited pages and records which source is right.",
    });
  }
  if (d.fieldCondition.value === "HUMAN_REVIEW") {
    out.push({
      why: d.fieldCondition.reason,
      resolvedBy: d.fieldCondition.recapture ?? "A person looks at the photograph and judges what it shows.",
    });
  }
  if (d.overall.value === "POTENTIAL_ISSUE") {
    out.push({
      why: "A visible defect sits inside a maintenance period that is still open, on a project whose documented scope covers this kind of work.",
      resolvedBy: "An engineer inspects the site and decides whether this defect falls under the contract's terms.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Why it matters — the practical significance of what was established
// ---------------------------------------------------------------------------

/** The no-fault boundary, stated verbatim wherever significance is stated. */
export const NO_FAULT_BOUNDARY = "This does not establish contractor fault, causation, negligence, or legal liability.";

export interface Significance {
  /**
   * One sentence per axis that the evidence actually settled, each carrying the claims it rests on
   * so a reader can open the cited page. An axis that was not established contributes nothing.
   */
  findings: Array<{ text: string; basedOnClaimIds: string[] }>;
  /** What the combination of those findings makes appropriate to do — never who is at fault. */
  consequence: string;
  /** Always `NO_FAULT_BOUNDARY`. Present on the type so no caller can render `consequence` alone. */
  boundary: string;
}

/**
 * Why the determination matters in practice, composed in code from the determination itself.
 *
 * Every sentence is gated on an axis whose value the evidence settled, and carries the claim ids
 * that settled it — so this is a restatement of verified evidence, not an interpretation layered on
 * top of it. Nothing here is model output, and `consequence` says what the evidence makes
 * *appropriate to do*, never what anyone did wrong: the strongest thing it will ever say is that a
 * matter warrants inspection by the authority.
 */
export function whyItMatters(d: Determination, claims: Claim[]): Significance {
  const findings: Significance["findings"] = [];
  const has = (id: string) => claims.some((c) => c.id === id);
  const ids = (xs: string[] | undefined) => (xs ?? []).filter(has);

  if (d.identity.value !== "VERIFIED") {
    findings.push({ text: "No public-works project has been established for the reported location.", basedOnClaimIds: [] });
  }

  // ACTIVE and EXPIRED are only ever returned with the computed end date, but the date is stated
  // conditionally rather than asserted: a stored determination that somehow lacks it must still
  // read as a sentence, not as "Invalid Date".
  const end = d.contractualStatus.windowEnd;
  if (d.contractualStatus.value === "ACTIVE") {
    findings.push({
      text: `The project record shows that the work is within its recorded defect-liability period${end ? `, which runs to ${fmtDate(end)}` : ""}.`,
      basedOnClaimIds: ids(d.contractualStatus.basedOnClaimIds),
    });
  } else if (d.contractualStatus.value === "EXPIRED") {
    findings.push({
      text: end
        ? `The project record shows that the work's recorded defect-liability period ended on ${fmtDate(end)}.`
        : "The project record shows that the work's recorded defect-liability period has ended.",
      basedOnClaimIds: ids(d.contractualStatus.basedOnClaimIds),
    });
  }

  const observation = claims.find((c) => c.field === "photo_observation");
  if (d.fieldCondition.value === "DEFECT_OBSERVED") {
    findings.push({
      text: "The submitted photograph shows a visible defect in the surface at the reported location.",
      basedOnClaimIds: observation ? [observation.id] : [],
    });
  } else if (d.fieldCondition.value === "NO_DEFECT_OBSERVED") {
    findings.push({
      text: "The submitted photograph was examined and does not show damage to public infrastructure.",
      basedOnClaimIds: observation ? [observation.id] : [],
    });
  }

  if (d.scopeRelationship.value === "POTENTIALLY_RELATED") {
    findings.push({
      text: "The project record also documents work covering the reported road section.",
      basedOnClaimIds: ids(d.scopeRelationship.basedOnClaimIds),
    });
  } else if (d.scopeRelationship.value === "NOT_ESTABLISHED") {
    findings.push({
      text: "The project's recorded scope describes work of a different kind from the condition reported here.",
      basedOnClaimIds: ids(d.scopeRelationship.basedOnClaimIds),
    });
  }

  return { findings, consequence: CONSEQUENCE(d), boundary: NO_FAULT_BOUNDARY };
}

/**
 * What the reader can do with the result. One sentence per overall state, and for SUPPORTED one
 * per sub-case, because "nothing to raise" and "raise it, but outside the maintenance period" are
 * different instructions to a citizen.
 */
function CONSEQUENCE(d: Determination): string {
  switch (d.overall.value) {
    case "POTENTIAL_ISSUE":
      return "This makes the issue appropriate for authority inspection under the project's documented maintenance context.";
    case "SUPPORTED":
      return d.fieldCondition.value === "NO_DEFECT_OBSERVED"
        ? "There is nothing here to put to the authority as a maintenance question: the records are in order and the photograph shows no damage."
        : "The defect can still be reported to the authority as a maintenance issue, but the records place it outside the project's recorded defect-liability period, so it does not fall within that period's maintenance context.";
    case "UNKNOWN":
      return "One of the records this rests on is not established, so the case cannot yet be put to the authority as a maintenance question. The open questions below name the record that would settle it, and the RTI draft requests it.";
    case "UNVERIFIED":
      return "Until the project is established, nothing can be said about any project's recorded obligations. The report can still be sent to the local authority as a civic complaint about the condition of the road.";
  }
}
