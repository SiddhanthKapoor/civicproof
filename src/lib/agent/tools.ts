/**
 * The investigation agent's tools. This is the complete list of things the model can do:
 * read the report, query the public-records corpus, and *propose* findings. There is no
 * tool that writes to external systems, changes case status, or submits anything.
 * Every call is authorized by policies/agent-tools.cedar before it runs.
 */
import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { CATEGORY_LABELS, ClaimFieldSchema, CLAIM_FIELD_LABELS, NEXT_ACTION_TYPES, type ProjectMatch } from "@/lib/schemas";
import { formatDistance, geometryLengthM } from "@/lib/geo";
import { normalizeText } from "./text";
import { verifyClaim } from "./verifier";
import type { RunContext } from "./context";

const MAX_PAGE_CHARS = 7000;

function json(v: unknown): string {
  return JSON.stringify(v, null, 1);
}

export function scoreMatches(ctx: RunContext, radiusM: number): ProjectMatch[] {
  const c = ctx.caseData;
  const reportText = normalizeText(`${c.title} ${c.description} ${c.location.address ?? ""}`);
  return ctx.corpus.projectsNear(c.location, radiusM).map(({ project, distanceM }) => {
    const reasons: string[] = [];
    const geomNote =
      project.geometrySource.kind === "official"
        ? "official coordinates"
        : project.geometrySource.kind === "openstreetmap"
          ? "road alignment from OpenStreetMap"
          : "approximate geocoded location";
    reasons.push(`${formatDistance(distanceM)} from the project (${geomNote})`);
    const categoryHit = project.categories.includes(c.category);
    if (categoryHit) reasons.push(`"${CATEGORY_LABELS[c.category]}" falls within this project's type of work`);
    const nameHit = project.roadNames.find((r) => {
      const n = normalizeText(r);
      return n.length > 3 && reportText.includes(n);
    });
    if (nameHit) reasons.push(`The report mentions "${nameHit}"`);
    const proximity = Math.max(0, 1 - distanceM / Math.max(radiusM, 1));
    const score = Math.round((proximity * 0.7 + (categoryHit ? 0.15 : 0) + (nameHit ? 0.15 : 0)) * 100) / 100;
    return { projectId: project.id, projectName: project.name, distanceM: Math.round(distanceM), score, reasons };
  }).sort((a, b) => b.score - a.score);
}

/** What each field means, for the model. Ambiguous ones are spelled out because models conflate them. */
const FIELD_GUIDE = [
  "project_name: name of the work as printed",
  "project_id: work, package or tender ID as printed (e.g. KN03-70)",
  "agency: executing department or unit",
  "contractor: contractor named in the record",
  "sanctioned_cost, estimated_cost, contract_value, maintenance_cost: amounts with their unit, even when a table states the unit in a note (e.g. '364.29 lakh')",
  "work_order_date, award_date, start_date: only a date the record labels that way (a sanction year is not a start date)",
  "completion_date: the physical completion of the works; a financial completion or closure date is a different fact, so record it as 'other' and say 'financial completion' in the text",
  "completion_period: time allowed to complete",
  "defect_liability: defect liability or maintenance period (e.g. '5 years')",
  "scope, roads_covered, work_status, quality_grade, audit_finding: as printed",
  "location_match, maintenance_window, reported_condition, photo_observation: computed or reported elsewhere; do not record these",
  "other: any other relevant fact",
].join("; ");

export function buildTools(ctx: RunContext) {
  const getCaseReport = tool({
    name: "get_case_report",
    description: "Read the citizen's report for this case: what they observed, where, when, and photo metadata.",
    inputSchema: z.object({}),
    callback: () => {
      ctx.setStage("intake");
      const c = ctx.caseData;
      const photoObs = ctx.claims.find((cl) => cl.field === "photo_observation");
      ctx.trace({ kind: "tool_call", tool: "get_case_report", stage: "intake", summary: `Read report ${c.id}: "${c.title}"` });
      return json({
        case_id: c.id,
        title: c.title,
        description: c.description,
        category: CATEGORY_LABELS[c.category],
        observed_on: c.observedOn,
        location: {
          lat: c.location.lat,
          lng: c.location.lng,
          address: c.location.address,
          how_obtained: c.location.source,
          ...(ctx.place ? { road_at_pin: ctx.place.road, locality_at_pin: ctx.place.locality, geocoder: ctx.place.provider } : {}),
        },
        photos: c.photos.map((p) => ({ sha256: p.sha256.slice(0, 16), exif_taken_at: p.exif?.takenAt, exif_gps: p.exif?.lat !== undefined })),
        ai_photo_observation: photoObs ? photoObs.text : "not available",
        reporter_documents: c.documents
          .filter((d) => d.textPages > 0)
          .map((d) => ({ doc_id: d.id, title: d.title, kind: d.kind, pages: d.pageCount, note: "Uploaded by the reporter (e.g. an RTI reply). Read and quote it like any record; claims from it are marked as coming from the reporter's upload." })),
      });
    },
  });

  const findProjectsNear = tool({
    name: "find_projects_near",
    description:
      "Find public-works projects in the records corpus whose location is within radius_m metres of the reported location. Returns candidates ranked by distance, type of work and name match.",
    inputSchema: z.object({ radius_m: z.number().int().min(50).max(5000).default(750) }),
    callback: ({ radius_m }) => {
      ctx.setStage("locate");
      const matches = scoreMatches(ctx, radius_m);
      ctx.matches = matches;
      ctx.candidateIds = matches.map((m) => m.projectId);
      ctx.emit({ type: "matches", matches });
      ctx.trace({
        kind: "tool_call",
        tool: "find_projects_near",
        stage: "locate",
        summary: matches.length
          ? `${matches.length} project${matches.length > 1 ? "s" : ""} within ${formatDistance(radius_m)}; nearest is ${matches[0].projectName} (${formatDistance(matches[0].distanceM)})`
          : `No projects in the corpus within ${formatDistance(radius_m)} of the report`,
        detail: { radius_m, matches: matches.map((m) => ({ id: m.projectId, d: m.distanceM, s: m.score })) },
      });
      return json({
        radius_m,
        candidates: matches.slice(0, 6).map((m) => {
          const p = ctx.corpus.getProject(m.projectId)!;
          return {
            project_id: p.id,
            name: p.name,
            road_names: p.roadNames,
            locality: p.locality,
            distance_m: m.distanceM,
            match_score: m.score,
            match_reasons: m.reasons,
            location_source: p.geometrySource.note,
            alignment_length_m: Math.round(geometryLengthM(p.geometry!)),
            agency_hint: ctx.corpus.getAuthority(p.agencyId)?.name,
            document_ids: p.documents,
          };
        }),
      });
    },
  });

  const selectProject = tool({
    name: "select_project",
    description:
      "Link the case to one candidate project returned by find_projects_near. Give concrete reasons (distance, road name, type of work). Only call when the location evidence supports it.",
    inputSchema: z.object({ project_id: z.string(), reasons: z.array(z.string()).min(1).max(5) }),
    callback: ({ project_id, reasons }) => {
      const p = ctx.corpus.getProject(project_id);
      if (!p) return "Error: unknown project_id.";
      ctx.selectedProjectId = p.id;
      ctx.emit({ type: "selected", projectId: p.id });
      ctx.trace({ kind: "decision", tool: "select_project", stage: "locate", summary: `Linked case to ${p.name}`, detail: { reasons } });
      return json({ selected: p.id, name: p.name, documents: p.documents });
    },
  });

  const listProjectDocuments = tool({
    name: "list_project_documents",
    description: "List the official documents associated with a project, with page counts and publishers.",
    inputSchema: z.object({ project_id: z.string() }),
    callback: ({ project_id }) => {
      ctx.setStage("retrieve");
      const p = ctx.corpus.getProject(project_id);
      if (!p) return "Error: unknown project_id.";
      const docs = p.documents.map((id) => ctx.corpus.getDocument(id)).filter(Boolean);
      ctx.trace({
        kind: "tool_call",
        tool: "list_project_documents",
        stage: "retrieve",
        summary: `${docs.length} document${docs.length === 1 ? "" : "s"} on record for ${p.name}`,
      });
      return json(
        docs.map((d) => ({
          doc_id: d!.id,
          title: d!.title,
          publisher: d!.publisher,
          source_type: d!.sourceType,
          pages: ctx.corpus.pageCount(d!.id),
          url: d!.url,
        })),
      );
    },
  });

  const searchDocuments = tool({
    name: "search_documents",
    description:
      "Full-text search over the official documents. Use specific terms (e.g. 'contractor', 'defect liability', 'agreement', a road name). Optionally restrict to one project's documents. Returns doc_id, page and a snippet.",
    inputSchema: z.object({ query: z.string().min(2).max(200), project_id: z.string().optional() }),
    callback: ({ query, project_id }) => {
      ctx.setStage("retrieve");
      const docIds = project_id ? ctx.corpus.getProject(project_id)?.documents : undefined;
      const results = ctx.corpus.search(query, { docIds, limit: 6 });
      ctx.trace({
        kind: "tool_call",
        tool: "search_documents",
        stage: "retrieve",
        summary: `Searched records for "${query}" — ${results.length} passage${results.length === 1 ? "" : "s"}`,
      });
      return json(results.map((r) => ({ doc_id: r.docId, page: r.page, snippet: r.snippet })));
    },
  });

  const readDocumentPage = tool({
    name: "read_document_page",
    description: "Read the extracted text of one page of an official document. Quote from this text exactly when recording claims.",
    inputSchema: z.object({ doc_id: z.string(), page: z.number().int().min(1) }),
    callback: ({ doc_id, page }) => {
      ctx.setStage("retrieve");
      const doc = ctx.corpus.getDocument(doc_id);
      const text = ctx.corpus.getPage(doc_id, page);
      if (!doc || text === undefined) return `Error: no page ${page} in document ${doc_id}.`;
      ctx.pagesRead.add(`${doc_id}#${page}`);
      ctx.trace({ kind: "tool_call", tool: "read_document_page", stage: "retrieve", summary: `Read p.${page} of "${doc.title}"` });
      const clipped = text.length > MAX_PAGE_CHARS ? text.slice(0, MAX_PAGE_CHARS) + "\n[…page truncated]" : text;
      return `DOCUMENT ${doc_id} — "${doc.title}" (${doc.publisher}) — page ${page} of ${ctx.corpus.pageCount(doc_id)}\n\n${clipped}`;
    },
  });

  const recordClaim = tool({
    name: "record_claim",
    description:
      "Propose one factual finding. For facts from official records set origin='official_record' and cite the exact words from the page (quote must be copied verbatim from read_document_page output, 1-3 sentences, including the value). A deterministic verifier checks every quote against the document; unsupported claims are stored as unverified. Use origin='ai_inference' for your own interpretation (no citation needed, it will be labelled as AI analysis).",
    inputSchema: z.object({
      field: ClaimFieldSchema.describe(FIELD_GUIDE),
      text: z.string().min(8).max(400).describe("Neutral sentence, e.g. 'The work order names M/s X as the contractor.'"),
      value: z
        .string()
        .max(200)
        .optional()
        .describe("The value as written in the record, with its unit: e.g. '364.29 lakh', '5 years', '05-03-2022', or the contractor's name"),
      origin: z.enum(["official_record", "ai_inference"]),
      citations: z
        .array(z.object({ doc_id: z.string(), page: z.number().int().min(1), quote: z.string().min(6).max(600) }))
        .max(4)
        .default([]),
      notes: z.string().max(300).optional(),
    }),
    callback: (input) => {
      ctx.setStage("extract");
      const result = verifyClaim(
        {
          field: input.field,
          text: input.text,
          value: input.value,
          origin: input.origin,
          notes: input.notes,
          citations: input.citations.map((c) => ({ docId: c.doc_id, page: c.page, quote: c.quote })),
        },
        ctx.corpus,
        new Date().toISOString().slice(0, 10),
      );
      ctx.claims.push(result.claim);
      ctx.evidence.push(...result.evidence);
      ctx.emit({ type: "claim", claim: result.claim, evidence: result.evidence });
      ctx.trace({
        kind: result.claim.verification === "unverified" && input.origin === "official_record" ? "rejected" : "tool_call",
        tool: "record_claim",
        stage: "extract",
        summary: `${CLAIM_FIELD_LABELS[input.field]}: ${input.value ?? input.text} → ${result.claim.verification.replace("_", " ")}`,
        detail: result.rejections.length ? { rejections: result.rejections } : undefined,
      });
      return json({
        claim_id: result.claim.id,
        verification: result.claim.verification,
        evidence_checks: result.evidence.map((e) => e.checkNote),
        rejected_citations: result.rejections,
        hint:
          result.claim.verification === "verified"
            ? undefined
            : "If the fact is in the document, re-read the page and copy the exact words containing the value. Do not retry with a different value unless the document states it.",
      });
    },
  });

  const flagMissing = tool({
    name: "flag_missing",
    description:
      "Record information that could not be found or verified in the available records (e.g. contractor not named, no defect liability clause available). Name the record that would settle it.",
    inputSchema: z.object({
      field: ClaimFieldSchema,
      reason: z.string().min(8).max(300),
      requestable_record: z.string().max(200).optional().describe("e.g. 'Contract agreement including defect liability clause'"),
    }),
    callback: ({ field, reason, requestable_record }) => {
      ctx.setStage("gaps");
      if (ctx.missing.some((m) => m.field === field)) return "Already flagged.";
      const item = { field, label: CLAIM_FIELD_LABELS[field], reason, requestableRecord: requestable_record };
      ctx.missing.push(item);
      ctx.emit({ type: "missing", item });
      ctx.trace({ kind: "tool_call", tool: "flag_missing", stage: "gaps", summary: `Not verified: ${item.label} — ${reason}` });
      return "Recorded.";
    },
  });

  const proposeNextAction = tool({
    name: "propose_next_action",
    description:
      "Suggest a concrete next step for the citizen, grounded in claim ids. The recipient and channel are filled in from the official authority directory, not by you.",
    inputSchema: z.object({
      type: z.enum(NEXT_ACTION_TYPES),
      title: z.string().min(6).max(120),
      rationale: z.string().min(10).max(500),
      based_on_claim_ids: z.array(z.string()).max(8).default([]),
    }),
    callback: (input) => {
      ctx.setStage("action");
      ctx.proposedActions.push({
        type: input.type,
        title: input.title,
        rationale: input.rationale,
        basedOnClaimIds: input.based_on_claim_ids.filter((id) => ctx.claims.some((c) => c.id === id)),
      });
      ctx.trace({ kind: "tool_call", tool: "propose_next_action", stage: "action", summary: `Suggested: ${input.title}` });
      return "Recorded.";
    },
  });

  const finish = tool({
    name: "finish",
    description:
      "End the investigation with a neutral 2-4 sentence summary of what the records show and what is missing, and optionally an analysis comparing the reported condition with the project's scope and dates. No accusations.",
    inputSchema: z.object({ summary: z.string().min(20).max(1200), analysis: z.string().max(1500).optional() }),
    callback: ({ summary, analysis }) => {
      ctx.setStage("action");
      ctx.summary = summary;
      ctx.analysis = analysis;
      ctx.finished = true;
      ctx.trace({ kind: "decision", tool: "finish", stage: "action", summary: "Investigation complete" });
      return "Done. Stop now.";
    },
  });

  return [
    getCaseReport,
    findProjectsNear,
    selectProject,
    listProjectDocuments,
    searchDocuments,
    readDocumentPage,
    recordClaim,
    flagMissing,
    proposeNextAction,
    finish,
  ];
}
