/**
 * Investigation orchestrator.
 *
 *   report ──▶ Strands Agent (Gemini | a model on Bedrock | rules planner)
 *                 │  every tool call ─▶ Cedar policy (agent-tools.cedar) ─▶ neutral-language guard
 *                 │  record_claim ────▶ grounding verifier (verbatim check against page text)
 *                 ▼
 *              finalize: conflicts · maintenance window · missing checklist · next actions
 *                 ▼
 *              DynamoDB / local store  (status change authorized by case-actions.cedar)
 *
 * Events are streamed to the caller as they happen and persisted periodically, so a
 * dropped connection never loses the run.
 */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AfterToolCallEvent, Agent, BedrockModel, BeforeToolCallEvent, ImageBlock, TextBlock, type Model } from "@strands-agents/sdk";
import { CedarAuthorization } from "@strands-agents/sdk/vended-interventions/cedar";
import { GoogleModel } from "@strands-agents/sdk/models/google";
import { config } from "@/lib/config";
import { getCorpus } from "@/lib/corpus";
import { withCaseDocuments } from "@/lib/corpus/with-case-documents";
import { readCaseDocumentPages } from "@/lib/cases";
import { getStore } from "@/lib/store";
import { getBlobs } from "@/lib/blob";
import { authorize } from "@/lib/authz";
import { newId } from "@/lib/ids";
import { errorMessage, log, metrics } from "@/lib/log";
import type { Case, CaseStatus, Investigation, TraceStep } from "@/lib/schemas";
import { createRunContext, type AgentEvent, type RunContext } from "./context";
import { buildTools } from "./tools";
import { RulesPlanner } from "./rules-planner";
import { NeutralLanguageGuard } from "./guards";
import { finalizeClaims } from "./finalize";
import { resolveIdentityFromCode } from "./identity";
import { distanceToGeometry } from "@/lib/geo";
import { PHOTO_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { describeModelError, RateLimitRetry } from "./rate-limit";
import { geminiApiKey } from "@/lib/secrets";
import { reverseGeocode } from "@/lib/geocode";

export type StreamEvent =
  | AgentEvent
  | { type: "started"; runId: string; engine: Investigation["engine"]; model?: string }
  | { type: "complete"; caseData: Case }
  | { type: "failed"; error: string };

function bedrockModel(maxTokens: number, modelId = config.bedrockModelId): BedrockModel {
  return new BedrockModel({
    region: config.bedrockRegion,
    modelId,
    maxTokens,
    // Prompt caching where the model supports it: tools, system prompt and the growing conversation
    // prefix are re-sent every turn, so caching them cuts most of an investigation's input-token cost.
    cacheConfig: { strategy: modelId.includes("anthropic") ? "anthropic" : "auto" },
    ...(config.bedrockEndpoint
      ? { stream: false, clientConfig: { endpoint: config.bedrockEndpoint, credentials: { accessKeyId: "test", secretAccessKey: "test" } } }
      : {}),
    ...(process.env.BEDROCK_GUARDRAIL_ID
      ? {
          guardrailConfig: {
            guardrailIdentifier: process.env.BEDROCK_GUARDRAIL_ID,
            guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? "DRAFT",
          },
        }
      : {}),
  });
}

// Resolved once per run (from the environment, or Secrets Manager on AWS) before any model is built.
let resolvedGeminiKey: string | undefined;

function geminiModel(maxTokens: number): GoogleModel {
  return new GoogleModel({
    apiKey: resolvedGeminiKey,
    modelId: config.geminiModelId,
    params: { maxOutputTokens: maxTokens, temperature: 0.2 },
    // A per-request timeout, so a stalled stream fails (and is retried) instead of hanging the run.
    clientConfig: { httpOptions: { timeout: 120_000, ...(config.geminiEndpoint ? { baseUrl: config.geminiEndpoint } : {}) } },
  });
}

/** The language model behind the investigator for this deployment (not used by the rules planner). */
function languageModel(maxTokens: number): Model {
  return config.planner === "gemini" ? geminiModel(maxTokens) : bedrockModel(maxTokens);
}

/** Model id recorded on the run, or undefined for the rules planner. */
export function modelIdFor(engine: Investigation["engine"]): string | undefined {
  return engine === "gemini" ? config.geminiModelId : engine === "bedrock" ? config.bedrockModelId : undefined;
}

const ENGINE_NAME: Record<Investigation["engine"], string> = {
  gemini: "Google Gemini",
  bedrock: "Amazon Bedrock",
  rules: "rules planner, no language model",
};

const PhotoObservation = z.object({
  infrastructure_damage_visible: z.boolean(),
  visible_issues: z.array(z.string()).max(6).describe("Short noun phrases, e.g. 'pothole', 'exposed aggregate', 'standing water'"),
  description: z.string().max(400).describe("One or two neutral sentences describing what is visible"),
  severity: z.enum(["minor", "moderate", "severe", "unclear"]),
});

/** Describes the reporter's photo with the model's vision. The result is labelled as an AI observation. */
async function analyzePhoto(ctx: RunContext) {
  const photo = ctx.caseData.photos[0];
  const blob = await getBlobs().get(photo.key);
  if (!blob) return;
  const format = photo.mime === "image/png" ? "png" : photo.mime === "image/webp" ? "webp" : "jpeg";
  ctx.setStage("intake");
  ctx.trace({ kind: "tool_call", tool: "analyze_photo", stage: "intake", summary: `Describing the reporter's photo with ${ENGINE_NAME[config.planner]} vision` });
  const agent = new Agent({ model: languageModel(4000), printer: false, structuredOutputSchema: PhotoObservation, retryStrategy: rateLimitRetry(ctx) });
  const res = await agent.invoke([new ImageBlock({ format, source: { bytes: blob.body } }), new TextBlock(PHOTO_PROMPT)]);
  const obs = res.structuredOutput as z.infer<typeof PhotoObservation> | undefined;
  if (!obs) {
    ctx.trace({ kind: "error", tool: "analyze_photo", stage: "intake", summary: "The photo analysis returned nothing usable, so the field condition stays unassessed." });
    return;
  }
  // Kept on the run context: the field-condition determination is derived from it deterministically.
  ctx.photoObservation = obs;
  const claim = {
    id: newId("cl"),
    field: "photo_observation" as const,
    text: obs.description,
    value: obs.visible_issues.join(", "),
    evidenceIds: [],
    verification: "unverified" as const,
    confidence: 0.5,
    origin: "ai_inference" as const,
    notes: `AI description of the reporter's photo (severity: ${obs.severity}). Not verified against any record.`,
  };
  ctx.claims.push(claim);
  ctx.emit({ type: "claim", claim, evidence: [] });
}

/** Waits out rate limits (e.g. Gemini's free tier) and shows the wait in the live trace. */
function rateLimitRetry(ctx: RunContext, maxAttempts?: number) {
  return new RateLimitRetry(
    (waitMs, attempt, reason) =>
    ctx.trace({
      kind: "note",
      summary: `${ENGINE_NAME[config.planner]} ${reason === "overloaded" ? "is overloaded" : "rate limit reached"}; waiting ${Math.round(waitMs / 1000)} s before retrying (attempt ${attempt + 1})`,
    }),
    maxAttempts,
  );
}

/**
 * The prompt for a fallback model that picks up an interrupted run. The run context (selected
 * project, recorded claims, candidates for Cedar) carries over, so the new model continues rather
 * than repeating the work, and never sees the other provider's message format.
 */
function continuationPrompt(caseId: string, ctx: RunContext): string {
  const recorded = ctx.claims
    .filter((c) => c.origin !== "computed")
    .map((c) => `- ${c.field}: ${c.value ?? c.text} (${c.verification.replace("_", " ")})`);
  return [
    `Investigate case ${caseId}. Another model started this investigation and was interrupted; its work is kept and summarised here.`,
    ctx.selectedProjectId
      ? `Selected project: ${ctx.selectedProjectId}.`
      : "No project has been selected yet: read the report and search near its location first.",
    recorded.length ? `Facts already recorded (do not record them again):\n${recorded.join("\n")}` : "No facts have been recorded yet.",
    ctx.missing.length ? `Already flagged as missing: ${ctx.missing.map((m) => m.field).join(", ")}.` : "",
    "Continue from there: read what is still needed, record the remaining facts with exact quotes, flag what cannot be found, then call finish.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function agentPolicy(): string {
  return readFileSync(path.join(process.cwd(), "policies", "agent-tools.cedar"), "utf8");
}

export async function runInvestigation(caseId: string, onEvent: (e: StreamEvent) => void): Promise<Case> {
  const store = getStore();
  const corpus = getCorpus();
  const engine = config.planner;
  const usesModel = engine !== "rules";
  const modelId = modelIdFor(engine);
  let modelLabel = modelId;
  const runId = newId("run");
  const startedAt = new Date().toISOString();
  const trace: TraceStep[] = [];

  const agentMayMove = (to: CaseStatus) =>
    authorize({ type: "Agent", id: "investigator" }, "ChangeStatus", caseId, { to_status: to }).allowed;

  const initial = await store.update(caseId, (c) => {
    const inv: Investigation = {
      runId,
      engine,
      model: modelId,
      status: "running",
      startedAt,
      matches: [],
      claims: [],
      evidence: [],
      missing: [],
      conflicts: [],
      nextActions: [],
      trace: [],
    };
    const early = ["reported", "investigating", "evidence_found", "case_prepared"].includes(c.status);
    return {
      ...c,
      status: early && agentMayMove("investigating") ? "investigating" : c.status,
      investigation: inv,
      timeline: [
        ...c.timeline,
        {
          id: newId("ev"),
          at: startedAt,
          type: "investigation_started",
          actor: "agent",
          summary: usesModel ? `Investigation started (${ENGINE_NAME[engine]} · ${modelId})` : `Investigation started (${ENGINE_NAME.rules})`,
        },
      ],
    };
  });

  onEvent({ type: "started", runId, engine, model: modelId });
  log.info("investigation.start", { caseId, runId, engine });

  const caseDocs = await Promise.all(
    initial.documents.filter((d) => d.textPages > 0).map(async (doc) => ({ doc, pages: await readCaseDocumentPages(doc) })),
  );
  const ctx = createRunContext(initial, withCaseDocuments(corpus, initial.id, caseDocs), (e) => {
    if (e.type === "trace") trace.push(e.step);
    onEvent(e);
  });

  // Periodic persistence so a refresh mid-run shows progress.
  let dirty = false;
  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    await store.update(caseId, (c) =>
      // Only touch a run that is still in progress: a late flush must never overwrite the final result.
      c.investigation?.runId === runId && c.investigation.status === "running"
        ? {
            ...c,
            investigation: {
              ...c.investigation,
              matches: ctx.matches,
              selectedProjectId: ctx.selectedProjectId,
              claims: ctx.claims,
              evidence: ctx.evidence,
              missing: ctx.missing,
              trace,
              records: ctx.liveRecords.map((r) => r.id),
            },
          }
        : c,
    );
  };
  const origEmit = ctx.emit;
  ctx.emit = (e) => {
    dirty = true;
    origEmit(e);
  };
  const timer = setInterval(() => void flush().catch(() => undefined), 1500);

  let toolCalls = 0;
  const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };

  try {
    if (engine === "gemini") {
      resolvedGeminiKey = await geminiApiKey();
      if (!resolvedGeminiKey) throw new Error("No Gemini API key is configured (GEMINI_API_KEY or GEMINI_SECRET_ARN).");
    }
    // An identifier the reporter supplied is the strongest signal there is, so it is resolved first.
    // It is never required: without one, candidates come from the location and road name instead.
    if (initial.jobCode) {
      const resolved = resolveIdentityFromCode({
        rawText: initial.jobCode,
        method: "manual_job_code",
        lookup: (code) => ctx.corpus.findProjectsByCode(code),
        // Distance only orders what the identifier already narrowed; it never chooses.
        order: (candidates) =>
          [...candidates].sort(
            (a, b) =>
              (a.geometry ? distanceToGeometry(initial.location, a.geometry) : Number.POSITIVE_INFINITY) -
              (b.geometry ? distanceToGeometry(initial.location, b.geometry) : Number.POSITIVE_INFINITY),
          ),
      });
      ctx.identity = resolved.identity;
      ctx.setStage("locate");
      ctx.trace({
        kind: "decision",
        tool: "resolve_identity",
        stage: "locate",
        summary: resolved.identity.reason,
        detail: { normalizedCode: resolved.identity.normalizedCode, registryMatches: resolved.identity.registryMatches ?? 0 },
      });
      const asMatch = (p: { id: string; name: string; geometry?: unknown }) => ({
        projectId: p.id,
        projectName: p.name,
        score: 1,
        reasons: [`Work identifier ${resolved.identity.normalizedCode} matches this project in the registry`],
        linkedBy: "job_code" as const,
        ...(p.geometry ? { distanceM: Math.round(distanceToGeometry(initial.location, p.geometry as never)) } : {}),
      });
      if (resolved.projectId) {
        const project = ctx.corpus.getProject(resolved.projectId)!;
        ctx.matches = [asMatch(project), ...ctx.matches];
        ctx.candidateIds.push(project.id);
        ctx.selectedProjectId = project.id;
        ctx.emit({ type: "matches", matches: ctx.matches });
        ctx.emit({ type: "selected", projectId: project.id });
      } else if (resolved.candidates.length) {
        // Shown so a person can choose, but deliberately NOT added to candidateIds: the Cedar policy
        // only permits select_project for a candidate id, so nothing can pick one of these for them.
        ctx.matches = [...resolved.candidates.map(asMatch), ...ctx.matches];
        ctx.emit({ type: "matches", matches: ctx.matches });
      }
    }

    // Which road is at the pin: records name roads, so the model searches by name as well as distance.
    if (usesModel) {
      const place = await reverseGeocode(initial.location.lat, initial.location.lng).catch(() => undefined);
      if (place) ctx.place = { road: place.road, locality: place.locality, district: place.district, label: place.label, provider: place.provider };
    }
    if (usesModel && initial.photos.length) {
      try {
        await analyzePhoto(ctx);
      } catch (e) {
        ctx.trace({ kind: "error", tool: "analyze_photo", summary: `Photo analysis failed: ${errorMessage(e)}` });
      }
    }

    // One agent per model. Cedar and the guard are per agent; the run context is shared.
    const buildAgent = (model: Model, maxAttempts?: number) => {
      const cedar = new CedarAuthorization({
        policies: agentPolicy(),
        principal: { type: "Agent", id: "investigator" },
        contextEnricher: () => ({
          candidate_ids: ctx.candidateIds,
          found_record_ids: [...ctx.foundRecordIds],
          live_searches: ctx.liveSearches,
          live_fetches: ctx.liveFetches,
        }),
        onError: "deny",
      });
      const guard = new NeutralLanguageGuard((tool, term) =>
        ctx.trace({ kind: "denied", tool, summary: `Neutral-language guard stopped "${term}" in ${tool}; the model was asked to rephrase` }),
      );
      const agent = new Agent({
        model,
        tools: buildTools(ctx),
        interventions: [cedar, guard],
        systemPrompt: SYSTEM_PROMPT,
        printer: false,
        ...(usesModel ? { retryStrategy: rateLimitRetry(ctx, maxAttempts) } : {}),
      });
      agent.addHook(BeforeToolCallEvent, (ev) => {
        toolCalls++;
        if (toolCalls > config.maxAgentToolCalls && ev.toolUse.name !== "finish") {
          ev.cancel = "Tool-call budget for this run is used up. Call finish now with what you have.";
          ctx.trace({ kind: "denied", tool: ev.toolUse.name, summary: "Run budget reached; the model was told to finish" });
        }
      });
      agent.addHook(AfterToolCallEvent, (ev) => {
        if (ev.result.status !== "error") return;
        const text = ev.result.content.map((b) => ("text" in b ? String(b.text) : "")).join(" ");
        if (/Cedar/i.test(text)) {
          ctx.trace({ kind: "denied", tool: ev.toolUse.name, summary: `Cedar policy denied ${ev.toolUse.name}`, detail: { reason: text.slice(0, 300) } });
        }
      });
      return agent;
    };

    const deadline = AbortSignal.timeout(usesModel ? config.runTimeoutMs : 30_000);
    // On AWS, a Gemini run that loses its model (daily quota, persistent overload) continues on Amazon Bedrock.
    const fallback = engine === "gemini" ? config.fallbackModelId : undefined;
    // Thinking tokens count toward the output limit on current models; leave room so a turn is never cut off.
    const primary = usesModel ? languageModel(16000) : new RulesPlanner(ctx);
    let result;
    try {
      result = await buildAgent(primary, fallback ? 3 : undefined).invoke(`Investigate case ${initial.id}. Start by reading the report.`, { cancelSignal: deadline });
    } catch (e) {
      const why = usesModel ? describeModelError(errorMessage(e), ENGINE_NAME[engine]) : undefined;
      if (!why) throw e;
      log.warn("investigation.fallback", { caseId, runId, from: modelId, to: fallback ?? "rules", reason: errorMessage(e).slice(0, 300) });
      if (fallback) {
        ctx.trace({ kind: "note", summary: `${why.split(". ")[0]}. Continuing on Amazon Bedrock (${fallback}) with the work done so far.` });
        modelLabel = `${modelId} → ${fallback}`;
        result = await buildAgent(bedrockModel(16000, fallback)).invoke(continuationPrompt(initial.id, ctx), { cancelSignal: deadline });
      } else {
        // No second model here (e.g. running locally): finish with the rules planner, and say so.
        ctx.trace({
          kind: "note",
          summary: `${why.split(". ")[0]}. Finishing with the rules planner (no language model): it records the checked reference facts for ${ctx.selectedProjectId ? "the project already linked" : "a project at this location, if any"}.`,
        });
        modelLabel = `${modelId} → rules planner`;
        result = await buildAgent(new RulesPlanner(ctx)).invoke("Continue the investigation.", { cancelSignal: AbortSignal.timeout(30_000) });
      }
    }
    if (result.metrics) {
      usage.inputTokens = result.metrics.accumulatedUsage.inputTokens;
      usage.outputTokens = result.metrics.accumulatedUsage.outputTokens;
      usage.modelCalls = result.metrics.cycleCount;
    }
    if (!ctx.finished) {
      ctx.trace({
        kind: "note",
        summary: result.stopReason === "cancelled" ? "Run stopped at the time limit before the model called finish" : "The model ended without calling finish",
      });
    }

    const fin = finalizeClaims(ctx);
    const verifiedOfficial = fin.claims.filter((c) => c.verification === "verified" && c.origin === "official_record").length;
    const finishedAt = new Date().toISOString();

    clearInterval(timer);
    const finalCase = await store.update(caseId, (c) => {
      // Verified facts about a project whose identity is not established say nothing about this
      // report, so they must not advance the case (spec item D).
      const identityVerified = fin.determination.identity.value === "VERIFIED";
      const target: CaseStatus = identityVerified && verifiedOfficial > 0 ? "evidence_found" : "investigating";
      const canMove = ["reported", "investigating"].includes(c.status) && agentMayMove(target);
      return {
        ...c,
        status: canMove ? target : c.status,
        investigation: {
          runId,
          engine,
          model: modelLabel,
          status: "complete",
          startedAt,
          finishedAt,
          matches: ctx.matches,
          selectedProjectId: ctx.selectedProjectId,
          claims: fin.claims,
          evidence: ctx.evidence,
          missing: fin.missing,
          conflicts: fin.conflicts,
          nextActions: fin.nextActions,
          determination: fin.determination,
          summary: ctx.summary,
          analysis: ctx.analysis,
          trace,
          records: ctx.liveRecords.map((r) => r.id),
          usage: usesModel ? usage : undefined,
        },
        timeline: [
          ...c.timeline,
          {
            id: newId("ev"),
            at: finishedAt,
            type: "investigation_completed",
            actor: "agent",
            summary: `Investigation completed: ${verifiedOfficial} verified fact${verifiedOfficial === 1 ? "" : "s"}, ${fin.missing.length} open question${fin.missing.length === 1 ? "" : "s"}`,
          },
        ],
      };
    });
    const proposed = fin.claims.filter((c) => c.origin === "official_record" || c.origin === "ai_inference");
    metrics(
      "investigation.complete",
      { Engine: engine },
      {
        Investigations: [1, "Count"],
        DurationSeconds: [(Date.parse(finishedAt) - Date.parse(startedAt)) / 1000, "Seconds"],
        VerifiedFacts: [verifiedOfficial, "Count"],
        // Share of the model's own factual claims that the verifier accepted.
        VerifiedShare: [proposed.length ? (100 * verifiedOfficial) / proposed.length : 0, "Percent"],
        UnverifiedClaims: [fin.claims.filter((c) => c.verification === "unverified" && c.origin !== "computed").length, "Count"],
        Conflicts: [fin.conflicts.length, "Count"],
        PolicyDenials: [trace.filter((t) => t.kind === "denied").length, "Count"],
        ModelWaits: [trace.filter((t) => t.kind === "note" && /rate limit|overloaded/.test(t.summary)).length, "Count"],
        ToolCalls: [toolCalls, "Count"],
        ModelCalls: [usage.modelCalls, "Count"],
        InputTokens: [usage.inputTokens, "Count"],
        OutputTokens: [usage.outputTokens, "Count"],
      },
      { caseId, runId, model: modelLabel },
    );
    onEvent({ type: "complete", caseData: finalCase });
    return finalCase;
  } catch (e) {
    clearInterval(timer);
    const raw = errorMessage(e);
    const message = describeModelError(raw, ENGINE_NAME[engine]) ?? raw;
    log.error("investigation.failed", { caseId, runId, engine, error: raw });
    metrics("investigation.failed.metric", { Engine: engine }, { InvestigationFailures: [1, "Count"] }, { caseId, runId });
    const failed = await store.update(caseId, (c) => ({
      ...c,
      status: c.status === "investigating" ? (c.investigation?.claims.length ? "investigating" : "reported") : c.status,
      investigation: c.investigation
        ? {
            ...c.investigation,
            status: "failed",
            finishedAt: new Date().toISOString(),
            error: message,
            trace,
            claims: ctx.claims,
            evidence: ctx.evidence,
            records: ctx.liveRecords.map((r) => r.id),
          }
        : c.investigation,
      timeline: [
        ...c.timeline,
        { id: newId("ev"), at: new Date().toISOString(), type: "investigation_failed", actor: "system", summary: "Investigation failed; see error" },
      ],
    }));
    onEvent({ type: "failed", error: message });
    return failed;
  }
}
