import type { Case, CaseStatus, Category, Determination } from "@/lib/schemas";

/** Slim projection used for the map and list views. */
export interface CaseSummary {
  id: string;
  title: string;
  category: Category;
  status: CaseStatus;
  lat: number;
  lng: number;
  locality?: string;
  reportedAt: string;
  observedOn: string;
  demo: boolean;
  /** "A".."G" for a seeded demo case; absent on a real report. */
  demoLabel?: string;
  /** What the evidence established, when an investigation finished. The list views' headline. */
  overall?: Determination["overall"]["value"];
  photoKey?: string;
  projectName?: string;
  projectId?: string;
  verifiedClaims: number;
}

export interface CaseStore {
  get(id: string): Promise<Case | null>;
  create(c: Case): Promise<void>;
  /**
   * Read-modify-write with optimistic concurrency. The mutator may be re-run if another
   * writer got there first, so it must be a pure function of the case it is given.
   */
  update(id: string, mutate: (c: Case) => Case): Promise<Case>;
  list(limit?: number): Promise<CaseSummary[]>;
  /**
   * Removes a case. Used by `npm run seed -- --reset` to rebuild the demo set in place instead of
   * appending another copy of it; nothing in the application deletes a citizen's report.
   */
  delete(id: string): Promise<void>;
  /** Atomically increments a named counter and returns the new value. */
  increment(counter: string, ttlSeconds: number): Promise<number>;
}

export function summarize(c: Case): CaseSummary {
  const selected = c.investigation?.matches.find((m) => m.projectId === c.investigation?.selectedProjectId);
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    status: c.status,
    lat: c.location.lat,
    lng: c.location.lng,
    locality: c.location.locality,
    reportedAt: c.reportedAt,
    observedOn: c.observedOn,
    demo: c.demo,
    demoLabel: c.demoLabel,
    overall: c.investigation?.determination?.overall.value,
    photoKey: c.photos[0]?.key,
    projectName: selected?.projectName,
    projectId: selected?.projectId,
    verifiedClaims: c.investigation?.claims.filter((cl) => cl.verification === "verified").length ?? 0,
  };
}

export class ConflictError extends Error {
  constructor(message = "The case was modified concurrently") {
    super(message);
  }
}

export class NotFoundError extends Error {
  constructor(message = "Case not found") {
    super(message);
  }
}
