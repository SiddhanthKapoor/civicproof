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
import { errorMessage, log } from "@/lib/log";
import type { Case, CaseStatus, Investigation, TraceStep } from "@/lib/schemas";
import { createRunContext, type AgentEvent, type RunContext } from "./context";
import { buildTools } from "./tools";
import { RulesPlanner } from "./rules-planner";
import { NeutralLanguageGuard } from "./guards";
import { finalizeClaims } from "./finalize";
import { PHOTO_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { describeModelError, RateLimitRetry } from "./rate-limit";

export type StreamEvent =
  | AgentEvent
  | { type: "started"; runId: string; engine: Investigation["engine"]; model?: string }
  | { type: "complete"; caseData: Case }
  | { type: "failed"; error: string };

function bedrockModel(maxTokens: number): BedrockModel {
  return new BedrockModel({
    region: config.bedrockRegion,
    modelId: config.bedrockModelId,
    maxTokens,
    // Prompt caching: tools, system prompt and the growing conversation prefix are re-sent every
    // turn, so caching them cuts most of an investigation's input-token cost.
    cacheConfig: { strategy: config.bedrockModelId.includes("anthropic") ? "anthropic" : "auto" },
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

function geminiModel(maxTokens: number): GoogleModel {
  return new GoogleModel({
    apiKey: config.geminiApiKey,
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
  if (!obs) return;
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
function rateLimitRetry(ctx: RunContext) {
  return new RateLimitRetry((waitMs, attempt, reason) =>
    ctx.trace({
      kind: "note",
      summary: `${ENGINE_NAME[config.planner]} ${reason === "overloaded" ? "is overloaded" : "rate limit reached"}; waiting ${Math.round(waitMs / 1000)} s before retrying (attempt ${attempt + 1})`,
    }),
  );
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
        ? { ...c, investigation: { ...c.investigation, matches: ctx.matches, selectedProjectId: ctx.selectedProjectId, claims: ctx.claims, evidence: ctx.evidence, missing: ctx.missing, trace } }
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
    if (usesModel && initial.photos.length) {
      try {
        await analyzePhoto(ctx);
      } catch (e) {
        ctx.trace({ kind: "error", tool: "analyze_photo", summary: `Photo analysis failed: ${errorMessage(e)}` });
      }
    }

    const cedar = new CedarAuthorization({
      policies: agentPolicy(),
      principal: { type: "Agent", id: "investigator" },
      contextEnricher: () => ({ candidate_ids: ctx.candidateIds }),
      onError: "deny",
    });
    const guard = new NeutralLanguageGuard((tool, term) =>
      ctx.trace({ kind: "denied", tool, summary: `Neutral-language guard stopped "${term}" in ${tool}; the model was asked to rephrase` }),
    );

    // Thinking tokens count toward the output limit on current models; leave room so a turn is never cut off.
    const model: Model = usesModel ? languageModel(16000) : new RulesPlanner(ctx);
    const agent = new Agent({
      model,
      tools: buildTools(ctx),
      interventions: [cedar, guard],
      systemPrompt: SYSTEM_PROMPT,
      printer: false,
      ...(usesModel ? { retryStrategy: rateLimitRetry(ctx) } : {}),
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

    const result = await agent.invoke(
      `Investigate case ${initial.id}. Start by reading the report.`,
      { cancelSignal: AbortSignal.timeout(usesModel ? config.runTimeoutMs : 30_000) },
    );
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
      const target: CaseStatus = verifiedOfficial > 0 ? "evidence_found" : "investigating";
      const canMove = ["reported", "investigating"].includes(c.status) && agentMayMove(target);
      return {
        ...c,
        status: canMove ? target : c.status,
        investigation: {
          runId,
          engine,
          model: modelId,
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
          summary: ctx.summary,
          analysis: ctx.analysis,
          trace,
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
    log.info("investigation.complete", { caseId, runId, engine, verifiedOfficial, toolCalls, ...usage });
    onEvent({ type: "complete", caseData: finalCase });
    return finalCase;
  } catch (e) {
    clearInterval(timer);
    const raw = errorMessage(e);
    const message = describeModelError(raw, ENGINE_NAME[engine]) ?? raw;
    log.error("investigation.failed", { caseId, runId, engine, error: raw });
    const failed = await store.update(caseId, (c) => ({
      ...c,
      status: c.status === "investigating" ? (c.investigation?.claims.length ? "investigating" : "reported") : c.status,
      investigation: c.investigation
        ? { ...c.investigation, status: "failed", finishedAt: new Date().toISOString(), error: message, trace, claims: ctx.claims, evidence: ctx.evidence }
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
