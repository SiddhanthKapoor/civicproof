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
import { findQuote, normalizeText, sameFact, typedQuantity, valueSupported } from "./text";

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
    // An official-record claim must state a value we can check. A claim with no value is prose:
    // a real quote must never be enough to mark it verified (spec item A, item H).
    const hasValue = proposed.value?.trim() ? valueSupported(proposed.value, cite.quote) : false;
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
          : !proposed.value?.trim()
            ? `Excerpt found verbatim on page ${cite.page}, but the claim states no value to check against it.`
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

  // The same, when the unit note is on the cited page but wasn't quoted: cite the note too, so the
  // model isn't pushed into dropping the unit ("364.29" instead of "364.29 lakh") to get verified.
  if (!valueFound && proposed.value) {
    for (const e of evidence.filter((x) => x.checkNote?.startsWith("Excerpt found verbatim"))) {
      const note = pageUnitNote(proposed.value, e.excerpt, corpus.getPage(e.docId, e.page!) ?? "");
      if (!note) continue;
      valueFound = true;
      e.verification = "verified";
      e.strength = e.sourceType === "news" ? "moderate" : "strong";
      e.checkNote = `Excerpt found verbatim on page ${e.page}; the unit is stated in a note on the same page.`;
      evidence.push({ ...e, id: localId("ev"), excerpt: note, checkNote: `Unit note found verbatim on page ${e.page}.` });
      break;
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

  // Fail closed when a quantity's unit cannot be established from what was quoted.
  if (verification === "verified" && UNIT_REQUIRED.includes(proposed.field) && typedQuantity(proposed.value ?? "").kind === "count") {
    verification = "partially_verified";
    rejections.push(
      `"${proposed.value}" is a figure with no unit, so the amount cannot be established from the quoted text. Record the value with its unit as the document states it.`,
    );
    for (const e of evidence) {
      e.verification = "partially_verified";
      e.strength = "weak";
      e.checkNote = `${e.checkNote ?? ""} The value carries no unit, so the amount is not established.`.trim();
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

/**
 * For "364.29 lakh" cited to a table row that prints only "364.29": the sentence on the same page
 * that states the unit ("Note : All Costs are in Lakhs"), if there is one.
 */
export function pageUnitNote(value: string, excerpt: string, pageText: string): string | undefined {
  const m = normalizeText(value).match(/^(?:rs\s*)?([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|kms?|kilometres?)\b/);
  if (!m) return undefined;
  const number = m[1].replace(/[.,]/g, (c) => `\\${c}`);
  if (!new RegExp(`(^|[^\\d.,])${number}([^\\d]|$)`).test(normalizeText(excerpt))) return undefined;
  const unitKey = Object.keys(UNIT_WORDS).find((k) => UNIT_WORDS[k].some((w) => m[2] === w || m[2] === `${w}s`));
  if (!unitKey) return undefined;
  const words = UNIT_WORDS[unitKey].join("|");
  const note = new RegExp(`[^.\\n]*\\b(?:costs?|amounts?|figures?|values?|lengths?|rs\\.?)\\b[^.\\n]*\\bin\\s+(?:${words})\\b[^.\\n]*|\\((?:rs\\.?\\s*)?in\\s+(?:${words})\\)`, "i").exec(pageText);
  return note?.[0].trim();
}

/** Fields where two different values cannot both be right. */
/**
 * Fields whose value is meaningless without its unit. A bare figure cannot be verified on these:
 * "364.29" is not a cost, and accepting it is how a unit gets silently dropped (spec item 17).
 */
const UNIT_REQUIRED: ClaimField[] = [
  "sanctioned_cost",
  "contract_value",
  "estimated_cost",
  "maintenance_cost",
  "defect_liability",
  "completion_period",
];

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
  "estimated_cost",
  "award_date",
  "completion_period",
  "maintenance_cost",
  "work_status",
];

/**
 * Marks disagreeing claims as contradicted instead of silently picking one.
 * Returns the updated claims and a list of conflicts for the UI.
 */
/**
 * Groups claims on single-valued fields by the fact they state. Several claims stating the same
 * fact (the model recorded it twice, or in two formats) are merged into one that keeps every
 * citation. Claims stating different facts are all marked contradicted and reported as a conflict.
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
  const merged = new Map<string, Claim>();
  const dropped = new Set<string>();
  // A value that carries its unit outranks a bare figure, whatever the citation count: the merged
  // claim is what gets displayed and printed, and a unit must never be lost (spec item 17).
  const rank = (c: Claim) =>
    (c.verification === "verified" ? 2 : 1) * 100_000 +
    (typedQuantity(c.value!).kind === "count" ? 0 : 10_000) +
    c.evidenceIds.length * 10 +
    Math.min(c.value!.length, 9);

  for (const [field, group] of byField) {
    // Union-find over a symmetric predicate, so the clustering is the transitive closure and the
    // outcome cannot depend on the order the claims happen to arrive in.
    const parent = group.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (sameFact(group[i].value!, group[j].value!)) parent[find(i)] = find(j);
      }
    }
    const byRoot = new Map<number, Claim[]>();
    group.forEach((c, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), c]));
    const clusters: Claim[][] = [...byRoot.values()];
    if (clusters.length > 1) {
      group.forEach((c) => contradicted.add(c.id));
      conflicts.push({
        field,
        claimIds: group.map((c) => c.id),
        description: `Sources disagree on this field: ${clusters.map((cl) => `"${cl[0].value}"`).join(" vs ")}. Both are shown; neither has been chosen.`,
      });
      continue;
    }
    const cluster = clusters[0];
    if (cluster.length < 2) continue;
    // Ties are broken on the value and then the id, so the representative is a function of the
    // cluster's contents and never of the order the claims arrived in.
    const keep = [...cluster].sort(
      (a, b) => rank(b) - rank(a) || a.value!.localeCompare(b.value!) || a.id.localeCompare(b.id),
    )[0];
    merged.set(keep.id, { ...keep, evidenceIds: [...new Set(cluster.flatMap((c) => c.evidenceIds))] });
    cluster.filter((c) => c.id !== keep.id).forEach((c) => dropped.add(c.id));
  }
  return {
    claims: claims
      .filter((c) => !dropped.has(c.id))
      .map((c) => merged.get(c.id) ?? c)
      .map((c) => (contradicted.has(c.id) ? { ...c, verification: "contradicted" as const, confidence: Math.min(c.confidence, 0.4) } : c)),
    conflicts,
  };
}
