/**
 * The grounding verifier.
 *
 * The planner (Claude on Bedrock, or the rules planner) can only *propose* a claim with
 * citations. This module decides what the claim is worth:
 *
 *   verified            every cited excerpt occurs in the cited page AND the value is in it
 *   partially_verified  the excerpt occurs (or closely matches) but the value isn't literally in it
 *   unverified          no citation survives the check
 *   contradicted        another verified claim on the same field has a different value
 *
 * It is deterministic and does no model calls, so a hallucinated tender number or contractor
 * cannot reach a complaint packet as a verified fact.
 */
import type { Claim, ClaimField, Conflict, Evidence, Origin, SourceDocument, Verification } from "@/lib/schemas";
import { canonicalValue, findQuote, normalizeText, valueSupported } from "./text";

export interface CorpusReader {
  getDocument(docId: string): SourceDocument | undefined;
  getPage(docId: string, page: number): string | undefined;
  pageCount(docId: string): number;
}

export interface Citation {
  docId: string;
  page: number;
  quote: string;
}

export interface ProposedClaim {
  field: ClaimField;
  text: string;
  value?: string;
  citations: Citation[];
  origin: Origin;
  notes?: string;
}

export interface VerifiedClaimResult {
  claim: Claim;
  evidence: Evidence[];
  /** Human-readable reasons for rejected citations, surfaced in the agent trace. */
  rejections: string[];
}

let seq = 0;
function localId(prefix: string) {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export function verifyClaim(proposed: ProposedClaim, corpus: CorpusReader, retrievedAtFallback: string): VerifiedClaimResult {
  const claimId = localId("cl");
  const evidence: Evidence[] = [];
  const rejections: string[] = [];
  let bestQuote: "exact" | "fuzzy" | "none" = "none";
  let valueFound = false;

  for (const cite of proposed.citations.slice(0, 4)) {
    const doc = corpus.getDocument(cite.docId);
    if (!doc) {
      rejections.push(`Unknown document "${cite.docId}".`);
      continue;
    }
    const text = corpus.getPage(cite.docId, cite.page);
    if (text === undefined) {
      rejections.push(`"${doc.title}" has no page ${cite.page} (it has ${corpus.pageCount(cite.docId)}).`);
      continue;
    }
    const match = findQuote(text, cite.quote);
    if (match.kind === "none") {
      rejections.push(
        `Excerpt not found on page ${cite.page} of "${doc.title}" (best token overlap ${Math.round(match.coverage * 100)}%).`,
      );
      continue;
    }
    const hasValue = proposed.value ? valueSupported(proposed.value, cite.quote) : true;
    if (match.kind === "exact") bestQuote = "exact";
    else if (bestQuote === "none") bestQuote = "fuzzy";
    if (hasValue && match.kind === "exact") valueFound = true;

    const verification: Verification =
      match.kind === "exact" ? (hasValue ? "verified" : "partially_verified") : "partially_verified";
    evidence.push({
      id: localId("ev"),
      docId: doc.id,
      sourceTitle: doc.title,
      sourceUrl: doc.url,
      sourceType: doc.sourceType,
      publisher: doc.publisher,
      retrievedAt: doc.retrievedAt ?? retrievedAtFallback,
      page: cite.page,
      excerpt: cite.quote.trim(),
      verification,
      strength: match.kind === "exact" && hasValue ? (doc.sourceType === "news" ? "moderate" : "strong") : "weak",
      relatedClaimIds: [claimId],
      checkNote:
        match.kind === "fuzzy"
          ? `Excerpt closely matches page ${cite.page} (${Math.round(match.coverage * 100)}% of words, in order) but not verbatim.`
          : !hasValue
            ? `Excerpt found verbatim, but the stated value "${proposed.value}" does not appear in it.`
            : `Excerpt found verbatim on page ${cite.page}.`,
    });
  }

  // Tables often print a bare number in a row and state its unit once in a note
  // ("All Costs are in Lakhs"). Accept only if both excerpts were found verbatim.
  if (!valueFound && proposed.value) {
    const exact = evidence.filter((e) => e.checkNote?.startsWith("Excerpt found verbatim"));
    const split = splitUnitSupport(proposed.value, exact.map((e) => e.excerpt));
    if (split) {
      valueFound = true;
      for (const e of exact) {
        e.verification = "verified";
        e.strength = e.sourceType === "news" ? "moderate" : "strong";
        e.checkNote = `Excerpt found verbatim on page ${e.page}; ${split}.`;
      }
    }
  }

  let verification: Verification;
  if (evidence.length === 0) verification = "unverified";
  else if (valueFound) verification = "verified";
  else verification = "partially_verified";

  // News is corroboration, and a reporter's upload can't be authenticated: cap both at partial.
  if (verification === "verified" && evidence.every((e) => e.sourceType === "news" || e.sourceType === "user_upload")) {
    verification = "partially_verified";
    for (const e of evidence) {
      if (e.sourceType === "user_upload") e.checkNote = `${e.checkNote ?? ""} Found in a document uploaded by the reporter; its authenticity is not checked.`.trim();
    }
  }

  const confidence =
    verification === "verified" ? 0.95 : verification === "partially_verified" ? (bestQuote === "exact" ? 0.6 : 0.45) : 0.1;

  return {
    claim: {
      id: claimId,
      field: proposed.field,
      text: proposed.text.trim(),
      value: proposed.value?.trim(),
      evidenceIds: evidence.map((e) => e.id),
      verification,
      confidence,
      origin: evidence.length ? proposed.origin : proposed.origin === "official_record" ? "ai_inference" : proposed.origin,
      notes: proposed.notes,
    },
    evidence,
    rejections,
  };
}

const UNIT_WORDS: Record<string, string[]> = {
  lakh: ["lakh", "lakhs", "lac", "lacs"],
  crore: ["crore", "crores", "cr"],
  km: ["km", "kms", "kilometre", "kilometres"],
};

/**
 * "₹364.29 lakh" is supported when one verbatim excerpt contains "364.29" and another verbatim
 * excerpt states that the figures are in lakhs. Returns a note describing the match, or undefined.
 */
export function splitUnitSupport(value: string, excerpts: string[]): string | undefined {
  const m = normalizeText(value).match(/^(?:rs\s*)?([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|kms?|kilometres?)\b/);
  if (!m || excerpts.length < 2) return undefined;
  const number = m[1];
  const unitKey = Object.keys(UNIT_WORDS).find((k) => UNIT_WORDS[k].some((w) => m[2] === w || m[2] === `${w}s`));
  if (!unitKey) return undefined;
  const numberIn = excerpts.find((e) => new RegExp(`(^|[^\\d.,])${number.replace(/[.,]/g, (c) => `\\${c}`)}([^\\d]|$)`).test(normalizeText(e)));
  const unitIn = excerpts.find(
    (e) => e !== numberIn && UNIT_WORDS[unitKey].some((w) => new RegExp(`\\b${w}\\b`).test(normalizeText(e))),
  );
  if (!numberIn || !unitIn) return undefined;
  return `the figure ${number} appears verbatim and the unit (${unitKey}) is stated in another cited excerpt`;
}

/** Fields where two different values cannot both be right. */
const SINGLE_VALUED: ClaimField[] = [
  "project_id",
  "contractor",
  "agency",
  "sanctioned_cost",
  "contract_value",
  "work_order_date",
  "start_date",
  "completion_date",
  "defect_liability",
];

/**
 * Marks disagreeing claims as contradicted instead of silently picking one.
 * Returns the updated claims and a list of conflicts for the UI.
 */
export function detectConflicts(claims: Claim[]): { claims: Claim[]; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const byField = new Map<ClaimField, Claim[]>();
  for (const c of claims) {
    if (!c.value || !SINGLE_VALUED.includes(c.field)) continue;
    if (c.verification !== "verified" && c.verification !== "partially_verified") continue;
    byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
  }
  const contradicted = new Set<string>();
  for (const [field, group] of byField) {
    const values = new Map<string, Claim[]>();
    for (const c of group) {
      const k = canonicalValue(c.value!);
      values.set(k, [...(values.get(k) ?? []), c]);
    }
    if (values.size > 1) {
      const ids = group.map((c) => c.id);
      ids.forEach((id) => contradicted.add(id));
      conflicts.push({
        field,
        claimIds: ids,
        description: `Sources disagree on this field: ${[...values.values()].map((cs) => `"${cs[0].value}"`).join(" vs ")}. Both are shown; neither has been chosen.`,
      });
    }
  }
  return {
    claims: claims.map((c) =>
      contradicted.has(c.id) ? { ...c, verification: "contradicted" as const, confidence: Math.min(c.confidence, 0.4) } : c,
    ),
    conflicts,
  };
}
