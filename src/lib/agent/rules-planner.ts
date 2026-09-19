/**
 * Rules planner: a deterministic stand-in for the LLM, implemented as a Strands `Model`.
 *
 * It drives the *same* agent loop, tools, Cedar policies and verifier as Claude on Bedrock,
 * but its decisions are fixed rules and its extractions are the human-curated references in
 * corpus/projects.json. It exists so the product works (and is testable) without AWS
 * credentials. The UI labels runs made with it as "Rules planner — no language model".
 */
import { Model, type StreamOptions, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { MIN_LOCATION_SCORE } from "./identity";
import { formatDistance } from "@/lib/geo";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { RunContext } from "./context";

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

/** The road the report names: the geocoded road at the pin, or the first part of the address. */
function roadNameFrom(ctx: RunContext): string | undefined {
  const raw = ctx.place?.road ?? ctx.caseData.location.address?.split(",")[0];
  const name = raw?.replace(/\b(main\s+)?(road|rd|street|st|cross|layout)\b\.?/gi, " ").replace(/\s+/g, " ").trim();
  return name && name.length >= 4 ? name : undefined;
}

function* plan(ctx: RunContext): Generator<Step> {
  // An identifier that narrowed to several projects is settled by a person, not by searching further:
  // stop here, before any location search can overwrite the candidates the identifier produced.
  if (ctx.identity?.value === "CODE_MATCHES_MULTIPLE_PROJECTS") {
    yield { tool: "get_case_report", input: {} };
    const offered = ctx.matches.slice(0, 5).map((m) => `${m.projectName}${m.distanceM !== undefined ? ` (${formatDistance(m.distanceM)})` : ""}`);
    yield {
      tool: "flag_missing",
      input: {
        field: "location_match",
        // flag_missing caps the reason at 300 characters; the candidate list goes in the summary.
        reason: `The work identifier ${ctx.identity.normalizedCode} matches ${ctx.matches.length} projects in the registry, so which one this report concerns is not established. One of the candidates shown has to be chosen.`,
        requestable_record: "Key map or reach details showing which of these works covers this location",
      },
    };
    yield {
      tool: "finish",
      input: {
        summary: `The work identifier ${ctx.identity.normalizedCode} narrowed this report to ${ctx.matches.length} projects but does not single one out: ${offered.join("; ")}. The field evidence is kept on the case; choosing which project this is would let the contractual checks run.`,
      },
    };
    return;
  }

  // Taking over a run a language model started (its quota ran out): keep the project it linked.
  const continued = ctx.selectedProjectId ? ctx.matches.find((m) => m.projectId === ctx.selectedProjectId) : undefined;
  if (!continued) {
    yield { tool: "get_case_report", input: {} };
    yield { tool: "find_projects_near", input: { radius_m: 750 } };
    if (!ctx.matches.length) yield { tool: "find_projects_near", input: { radius_m: 2000 } };
  }

  // Nothing mapped nearby: look the road up by the name the report gives (most rural roads have no
  // published alignment). Link only an unambiguous match: one project matching every term, and
  // within 5 km if it has a map line.
  let byName: RunContext["matches"][number] | undefined;
  const named = !continued && !ctx.matches.length ? roadNameFrom(ctx) : undefined;
  if (named) {
    yield { tool: "find_projects_by_name", input: { query: named } };
    const full = ctx.nameCandidates.filter((c) => c.score === 1 && (c.distanceM === undefined || c.distanceM <= 5000));
    if (full.length === 1) {
      const reasons = [`The report's address names “${named}”, which matches the record of ${full[0].name}`];
      yield { tool: "select_project", input: { project_id: full[0].projectId, reasons } };
      byName = ctx.matches.find((m) => m.projectId === full[0].projectId);
    } else if (full.length > 1) {
      yield {
        tool: "flag_missing",
        input: {
          field: "location_match",
          reason: `${full.length} projects in the records are named like “${named}” (${full.map((c) => c.name).slice(0, 3).join("; ")}). Which one this report concerns is not established.`,
          requestable_record: "Key map or reach details showing which work covers this location",
        },
      };
    }
  }

  if (!continued && !byName && !ctx.matches.length) {
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

  const top = continued ?? byName ?? ctx.matches[0];
  const runnerUp = continued || byName ? undefined : ctx.matches[1];
  const ambiguous = runnerUp && top.score - runnerUp.score < 0.05 && Math.abs((top.distanceM ?? 0) - (runnerUp.distanceM ?? 0)) < 30;
  // A location-only candidate must clear the floor; below it, nothing is linked and the gap is
  // reported instead of being papered over with the nearest guess.
  if (!continued && !byName && top.score < MIN_LOCATION_SCORE) {
    yield {
      tool: "flag_missing",
      input: {
        field: "location_match",
        reason: `The nearest project in the records (${top.projectName}${top.distanceM !== undefined ? `, ${formatDistance(top.distanceM)} away` : ""}) is too far from this report for its location alone to establish which contract covers this spot.`,
        requestable_record: "Key map or reach details showing which contract covers this location",
      },
    };
    yield { tool: "finish", input: { summary: `A report at this location could not be tied to a public-works project: the nearest in the records is ${top.projectName}${top.distanceM !== undefined ? `, ${formatDistance(top.distanceM)} away` : ""}, which its location alone does not establish.` } };
    return;
  }
  // An identifier that narrowed to several projects, or two candidates the location cannot separate,
  // both mean the same thing: a person has to choose. Nothing is selected on their behalf.
  if (!continued && !byName && ambiguous) {
    const offered = ctx.matches.slice(0, 5).map((m) => `${m.projectName}${m.distanceM !== undefined ? ` (${formatDistance(m.distanceM)})` : ""}`);
    yield {
      tool: "flag_missing",
      input: {
        field: "location_match",
        reason: `Two projects are equally close: ${top.projectName.slice(0, 60)} (${formatDistance(top.distanceM ?? 0)}) and ${runnerUp!.projectName.slice(0, 60)} (${formatDistance(runnerUp!.distanceM ?? 0)}). Which contract covers this exact spot is not established.`,
        requestable_record: "Key map or reach details showing which contract covers this location",
      },
    };
    yield {
      tool: "finish",
      input: {
        summary: `${ctx.matches.length} projects could cover this location and the evidence does not single one out: ${offered.join("; ")}. The field evidence is kept on the case; choosing the project is what would let the contractual checks run.`,
      },
    };
    return;
  }
  if (!continued && !byName) yield { tool: "select_project", input: { project_id: top.projectId, reasons: top.reasons } };
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
      summary: `Read the reporter's ${uploads.length === 1 ? "document" : `${uploads.length} documents`}. Extracting facts from new documents needs a language model (Gemini or Bedrock); the rules planner only uses curated records.`,
    });
  }

  const verified = ctx.claims.filter((c) => c.verification === "verified");
  const docs = new Set(ctx.evidence.filter((e) => e.verification === "verified").map((e) => e.docId));
  const facts = verified.map((c) => CLAIM_FIELD_LABELS[c.field].toLowerCase());
  yield {
    tool: "finish",
    input: {
      summary:
        (top.linkedBy === "name"
          ? top.distanceM !== undefined
            ? `The report was linked to ${project.name} by name; its mapped alignment is ${formatDistance(top.distanceM)} from the pin. `
            : `The report was linked to ${project.name} by the road and place names in its record, which has no map location. `
          : (top.distanceM ?? 0) < 15
            ? `The reported location lies on the alignment of ${project.name}. `
            : `The reported location is ${formatDistance(top.distanceM ?? 0)} from ${project.name}. `) +
        (verified.length
          ? `${verified.length} fact${verified.length === 1 ? " was" : "s were"} confirmed verbatim in ${docs.size} official document${docs.size === 1 ? "" : "s"} (${facts.join(", ")}). `
          : "No fact could be confirmed verbatim in the available documents. ") +
        (ambiguous ? `${runnerUp?.projectName} is equally close, so the responsible contract for this exact spot still needs confirming. ` : "") +
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
