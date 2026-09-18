import type {
  Case,
  Claim,
  Evidence,
  MissingItem,
  NextAction,
  ProjectMatch,
  TraceStep,
} from "@/lib/schemas";
import type { Corpus } from "@/lib/corpus";
import type { LiveRecord } from "@/lib/records/types";

export type AgentEvent =
  | { type: "trace"; step: TraceStep }
  | { type: "stage"; stage: StageId }
  | { type: "claim"; claim: Claim; evidence: Evidence[] }
  | { type: "missing"; item: MissingItem }
  | { type: "matches"; matches: ProjectMatch[] }
  | { type: "selected"; projectId: string };

import type { StageId } from "./stages";
export { STAGES, type StageId } from "./stages";

/** Mutable state for one investigation run, shared by the tools and the orchestrator. */
export interface RunContext {
  caseData: Case;
  corpus: Corpus;
  matches: ProjectMatch[];
  candidateIds: string[];
  selectedProjectId?: string;
  claims: Claim[];
  evidence: Evidence[];
  missing: MissingItem[];
  proposedActions: Array<Pick<NextAction, "type" | "title" | "rationale" | "basedOnClaimIds">>;
  pagesRead: Set<string>;
  /** Public records fetched live this run, and the ids searches returned (the only ones it may fetch). */
  liveRecords: LiveRecord[];
  foundRecordIds: Set<string>;
  liveSearches: number;
  liveFetches: number;
  /** The road and locality at the pin, from the geocoder (records name roads, not coordinates). */
  place?: { road?: string; locality?: string; district?: string; label: string; provider: string };
  summary?: string;
  analysis?: string;
  finished: boolean;
  stage?: StageId;
  emit(e: AgentEvent): void;
  trace(step: Omit<TraceStep, "at">): void;
  setStage(stage: StageId): void;
}

export function createRunContext(caseData: Case, corpus: Corpus, emit: (e: AgentEvent) => void): RunContext {
  const ctx: RunContext = {
    caseData,
    corpus,
    matches: [],
    candidateIds: [],
    claims: [],
    evidence: [],
    missing: [],
    proposedActions: [],
    pagesRead: new Set(),
    liveRecords: [],
    foundRecordIds: new Set(),
    liveSearches: 0,
    liveFetches: 0,
    finished: false,
    emit,
    trace(step) {
      emit({ type: "trace", step: { at: new Date().toISOString(), ...step } });
    },
    setStage(stage) {
      if (ctx.stage === stage) return;
      ctx.stage = stage;
      emit({ type: "stage", stage });
    },
  };
  return ctx;
}
