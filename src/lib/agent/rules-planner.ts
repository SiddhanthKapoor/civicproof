/**
 * Rules planner: a deterministic stand-in for the LLM, implemented as a Strands `Model`.
 *
 * It drives the *same* agent loop, tools, Cedar policies and verifier as Claude on Bedrock,
 * but its decisions are fixed rules and its extractions are the human-curated references in
 * corpus/projects.json. It exists so the product works (and is testable) without AWS
 * credentials. The UI labels runs made with it as "Rules planner — no language model".
 */
import { Model, type StreamOptions, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { formatDistance } from "@/lib/geo";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { RunContext } from "./context";

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

function* plan(ctx: RunContext): Generator<Step> {
  yield { tool: "get_case_report", input: {} };
  yield { tool: "find_projects_near", input: { radius_m: 750 } };
  if (!ctx.matches.length) yield { tool: "find_projects_near", input: { radius_m: 2000 } };

  if (!ctx.matches.length) {
    yield {
      tool: "flag_missing",
      input: {
        field: "project_name",
        reason: "No public-works project in the records CivicProof holds is within 2 km of this report.",
        requestable_record: "List of road works sanctioned or executed on this stretch in the last five years, with work orders",
      },
    };
    yield {
      tool: "finish",
      input: {
        summary:
          "No project in CivicProof's records corpus matches this location, so no contractor, budget or maintenance obligation could be verified. The complaint can still be filed with the location and photos, and the underlying works records can be requested under the RTI Act.",
      },
    };
    return;
  }

  const top = ctx.matches[0];
  const runnerUp = ctx.matches[1];
  const ambiguous = runnerUp && top.score - runnerUp.score < 0.05 && Math.abs(top.distanceM - runnerUp.distanceM) < 30;
  yield { tool: "select_project", input: { project_id: top.projectId, reasons: top.reasons } };
  if (ambiguous) {
    yield {
      tool: "flag_missing",
      input: {
        field: "location_match",
        reason: `Two projects are equally close: ${top.projectName} (${formatDistance(top.distanceM)}) and ${runnerUp.projectName} (${formatDistance(runnerUp.distanceM)}). Which contract covers this exact spot is not established.`,
        requestable_record: "Key map or reach details showing which contract covers this location",
      },
    };
  }
  yield { tool: "list_project_documents", input: { project_id: top.projectId } };

  const project = ctx.corpus.getProject(top.projectId)!;
  const pages = new Set<string>();
  for (const ref of project.reference) for (const c of ref.citations) pages.add(`${c.docId}#${c.page}`);
  for (const key of pages) {
    const [doc_id, page] = key.split("#");
    yield { tool: "read_document_page", input: { doc_id, page: Number(page) } };
  }

  for (const ref of project.reference) {
    yield {
      tool: "record_claim",
      input: {
        field: ref.field,
        text: ref.text,
        value: ref.value,
        origin: "official_record",
        citations: ref.citations.map((c) => ({ doc_id: c.docId, page: c.page, quote: c.quote })),
      },
    };
  }

  const uploads = ctx.caseData.documents.filter((d) => d.textPages > 0);
  for (const d of uploads) yield { tool: "read_document_page", input: { doc_id: d.id, page: 1 } };
  if (uploads.length) {
    ctx.trace({
      kind: "note",
      summary: `Read the reporter's ${uploads.length === 1 ? "document" : `${uploads.length} documents`}. Extracting facts from new documents needs the Bedrock planner; the rules planner only uses curated records.`,
    });
  }

  const verified = ctx.claims.filter((c) => c.verification === "verified");
  const docs = new Set(ctx.evidence.filter((e) => e.verification === "verified").map((e) => e.docId));
  const facts = verified.map((c) => CLAIM_FIELD_LABELS[c.field].toLowerCase());
  yield {
    tool: "finish",
    input: {
      summary:
        (top.distanceM < 15
          ? `The reported location lies on the alignment of ${project.name}. `
          : `The reported location is ${formatDistance(top.distanceM)} from ${project.name}. `) +
        (verified.length
          ? `${verified.length} fact${verified.length === 1 ? " was" : "s were"} confirmed verbatim in ${docs.size} official document${docs.size === 1 ? "" : "s"} (${facts.join(", ")}). `
          : "No fact could be confirmed verbatim in the available documents. ") +
        (ambiguous ? `${runnerUp.projectName} is equally close, so the responsible contract for this exact spot still needs confirming. ` : "") +
        "Anything not listed as verified should be treated as unconfirmed.",
    },
  };
}

export class RulesPlanner extends Model<{ modelId?: string }> {
  private steps: Generator<Step>;
  private n = 0;

  constructor(ctx: RunContext) {
    super();
    this.steps = plan(ctx);
  }

  updateConfig() {}
  getConfig() {
    return { modelId: "civicproof-rules-planner" };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *stream(_messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const next = this.steps.next();
    const step: Step = next.done ? { text: "Investigation complete." } : next.value;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("tool" in step) {
      this.n++;
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.tool, toolUseId: `rules-${this.n}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    } else {
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: step.text } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
    }
  }
}
