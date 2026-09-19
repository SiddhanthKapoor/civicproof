/**
 * Project identity resolution.
 *
 * The rule the whole product rests on: **a verified identifier establishes identity; a location only
 * suggests candidates** (spec items A and D). So this module never lets proximity pick a project.
 * The hierarchy it implements, highest first:
 *
 *   1. a work/package identifier (typed by the reporter, or read from a board — not built yet),
 *      looked up exactly in the registry;
 *   2. an explicit human choice among the projects that identifier narrowed to;
 *   3. a `project_id` verified verbatim against a document in the selected project's own bundle;
 *   4. otherwise UNVERIFIED — and nothing downstream runs on a guessed project.
 *
 * A location may order candidates so a person sees the nearest first. It may not choose between them.
 */
import type { Claim, Determination, Evidence } from "@/lib/schemas";
import type { Corpus, Project } from "@/lib/corpus";

/** The identifier shapes this registry actually uses; validated against all 778 codes it holds. */
export const JOB_CODE_PATTERN = /^[A-Z]{2}-?\d{2}-?\d{2,3}[A-Z]?$/;
export const WORK_INDENT_PATTERN = /^BBMP\/\d{4}-\d{2}\/[A-Z]{2}\/[A-Z_]+\d+$/;

/** Uppercases and tidies separators. It deliberately does not guess between look-alike characters. */
export function normalizeJobCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
}

export function isValidJobCode(code: string): boolean {
  return JOB_CODE_PATTERN.test(code) || WORK_INDENT_PATTERN.test(code);
}

export interface CodeResolution {
  identity: Determination["identity"];
  /** Set only when identity is VERIFIED. */
  projectId?: string;
  /** The projects the identifier narrowed to, in the order they should be offered. */
  candidates: Project[];
}

/**
 * Levels 1 and 2. `order` may reorder the candidates (by distance, say) but is never consulted to
 * choose: if an identifier matches several projects the result is CODE_MATCHES_MULTIPLE_PROJECTS and
 * a person has to pick.
 */
export function resolveIdentityFromCode(input: {
  rawText: string;
  method: Extract<Determination["identity"]["method"], "job_code" | "manual_job_code">;
  lookup: (code: string) => Project[];
  order?: (candidates: Project[]) => Project[];
  chosenProjectId?: string;
}): CodeResolution {
  const normalizedCode = normalizeJobCode(input.rawText);
  const base = { method: input.method, rawText: input.rawText, normalizedCode };

  if (!normalizedCode || !isValidJobCode(normalizedCode)) {
    return {
      candidates: [],
      identity: {
        ...base,
        value: "UNVERIFIED",
        patternValid: false,
        reason: `"${input.rawText}" is not in the form of a work or package identifier this registry uses, so it cannot be looked up.`,
      },
    };
  }

  const matches = input.lookup(normalizedCode);
  // An ordering function may only permute what the registry returned. Anything it adds is dropped
  // and anything it omits is put back, so a location can never introduce or remove a candidate.
  const ordered = input.order ? input.order(matches) : matches;
  const candidates = [
    ...ordered.filter((p) => matches.includes(p)),
    ...matches.filter((p) => !ordered.includes(p)),
  ];
  const common = { ...base, patternValid: true, registryMatches: matches.length };

  if (matches.length === 0) {
    return {
      candidates: [],
      identity: {
        ...common,
        value: "UNVERIFIED",
        reason: `No project in the registry carries the identifier ${normalizedCode}.`,
      },
    };
  }

  const chosen = input.chosenProjectId ? candidates.find((p) => p.id === input.chosenProjectId) : undefined;
  if (chosen) {
    return {
      candidates,
      projectId: chosen.id,
      identity: {
        ...common,
        value: "VERIFIED",
        candidateProjectIds: candidates.map((p) => p.id),
        reason: `The identifier ${normalizedCode} matches ${matches.length} project${matches.length === 1 ? "" : "s"} in the registry; this one was chosen from that list.`,
      },
    };
  }

  if (matches.length === 1) {
    return {
      candidates,
      projectId: candidates[0].id,
      identity: {
        ...common,
        value: "VERIFIED",
        candidateProjectIds: [candidates[0].id],
        reason: `The identifier ${normalizedCode} matches exactly one project in the registry.`,
      },
    };
  }

  return {
    candidates,
    identity: {
      ...common,
      value: "CODE_MATCHES_MULTIPLE_PROJECTS",
      candidateProjectIds: candidates.map((p) => p.id),
      reason: `The identifier ${normalizedCode} matches ${matches.length} projects in the registry — PMGSY package numbers repeat across blocks. Which one this report concerns has to be chosen; the nearest is listed first, but distance alone does not settle it.`,
    },
  };
}

/**
 * Level 3. A project the agent selected is only *established* once a `project_id` has been verified
 * verbatim against a document in that project's own bundle, and that value is the identifier the
 * registry holds for it. Location narrowed the field; the record is what identifies the work.
 */
export function resolveIdentityFromRecord(input: {
  project: Project | undefined;
  claims: Claim[];
  evidence: Evidence[];
  corpus: Pick<Corpus, "getPage" | "findProjectsByCode">;
  linkedBy?: "location" | "name" | "job_code";
}): Determination["identity"] {
  const { project, claims, evidence, corpus } = input;
  if (!project) {
    return {
      value: "UNVERIFIED",
      method: "none",
      reason: "No public-works project in the records matches this location.",
    };
  }
  const registryCode = project.reference.find((r) => r.field === "project_id")?.value?.trim().toUpperCase();
  const wanted = registryCode ? normalizeJobCode(registryCode) : undefined;
  const grounded = wanted
    ? claims.find(
        (c) =>
          c.field === "project_id" &&
          c.verification === "verified" &&
          normalizeJobCode(c.value ?? "") === wanted &&
          c.evidenceIds.some((id) => {
            const e = evidence.find((x) => x.id === id);
            return Boolean(
              e && project.documents.includes(e.docId) && e.page !== undefined && corpus.getPage(e.docId, e.page) !== undefined,
            );
          }),
      )
    : undefined;

  if (!grounded) {
    return {
      value: "UNVERIFIED",
      method: input.linkedBy === "name" ? "road_name" : "geographic",
      reason:
        "This project was suggested by the report's location, but its work identifier has not been confirmed word for word in the project's own records, so the identity is not established.",
      ...(registryCode ? { normalizedCode: registryCode } : {}),
    };
  }
  const matches = registryCode ? corpus.findProjectsByCode(registryCode) : [];
  return {
    value: "VERIFIED",
    method: "verified_record",
    normalizedCode: registryCode,
    patternValid: registryCode ? isValidJobCode(registryCode) : undefined,
    registryMatches: matches.length,
    candidateProjectIds: [project.id],
    reason: `The work identifier ${registryCode} is confirmed word for word in this project's own records, which is what establishes the identity; the report's location only narrowed the candidates.`,
  };
}

/**
 * The floor a location-only candidate must clear before it may even be *suggested*.
 *
 * Derived from the scoring in tools.ts, not invented: proximity contributes `0.7 * (1 - d/r)`, so at
 * the default 750 m radius a candidate on the alignment scores about 0.70, one 100 m away about
 * 0.61, and one 375 m away about 0.35. Category and road-name hits add 0.15 each. 0.55 therefore
 * admits a candidate essentially on the road and rejects one merely in the neighbourhood.
 */
export const MIN_LOCATION_SCORE = 0.55;
