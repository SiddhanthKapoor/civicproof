/**
 * Adds fetched public records to a corpus for one investigation (or one page view): each record
 * becomes a document the agent can read and quote, and a project it can link a case to by road name.
 * Such projects have no map geometry, so they never appear in location searches.
 */
import MiniSearch from "minisearch";
import type { Corpus } from "@/lib/corpus";
import type { Authority, Project } from "@/lib/corpus/types";
import type { SourceDocument } from "@/lib/schemas";
import type { LiveRecord } from "./types";

const KARNATAKA_RTI = {
  portalUrl: "https://rtionline.karnataka.gov.in",
  fee: "The Karnataka RTI Rules prescribe a ₹10 application fee; applicants below the poverty line are exempt.",
  requestWordLimit: 150,
  requestRule: "Karnataka Right to Information Rules, 2005, rule 14 (inserted in 2008): a request shall relate to one subject matter and shall not ordinarily exceed 150 words.",
  sourceUrl: "https://rtionline.karnataka.gov.in/index.php?lan=E",
};

/** Departments in the curated directory; anything else gets an authority built from the record. */
export function authorityIdFor(department: string | undefined): string | undefined {
  if (!department) return undefined;
  if (/bruhat bengaluru|bbmp|greater bengaluru|bengaluru (north|south|east|west|central) city corporation/i.test(department)) return "bbmp";
  if (/smart city/i.test(department)) return "bscl";
  return `dept-${department.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
}

export function liveDocument(r: LiveRecord): SourceDocument {
  return {
    id: r.id,
    title: r.title,
    publisher: r.publisher,
    sourceType: r.sourceType,
    url: r.viewUrl ?? r.url,
    retrievedAt: r.retrievedAt.slice(0, 10),
    sha256: r.sha256,
    pageCount: r.pages.length,
    notes: `Fetched by the investigator from ${r.url} on ${r.retrievedAt.slice(0, 10)}. ${r.notes ?? ""}`.trim(),
  };
}

export function liveProject(r: LiveRecord): Project {
  return {
    id: r.id,
    name: r.title,
    roadNames: r.roadNames,
    locality: r.location,
    city: "Bengaluru",
    state: "Karnataka",
    agencyId: authorityIdFor(r.department),
    categories: ["road_damage", "pothole", "drainage", "streetlight", "public_building", "water", "other"],
    geometrySource: { kind: "none", note: `No map location in the record; linked by the road name in its title (${r.reference ?? r.id}).` },
    documents: [r.id],
    reference: [],
    summary: [r.reference, r.department, r.location].filter(Boolean).join(" · "),
  };
}

function liveAuthority(r: LiveRecord): Authority | undefined {
  const id = authorityIdFor(r.department);
  if (!id?.startsWith("dept-") || !r.department) return undefined;
  return {
    id,
    name: r.department,
    jurisdiction: `As stated in the procurement record: ${r.department}${r.location ? `, ${r.location}` : ""}`,
    rti: { addressee: `The Public Information Officer, ${r.department}`, ...KARNATAKA_RTI },
  };
}

export function withLiveRecords(base: Corpus, records: LiveRecord[]): Corpus {
  if (!records.length) return base;
  const docs = new Map(records.map((r) => [r.id, liveDocument(r)]));
  const pages = new Map(records.map((r) => [r.id, r.pages]));
  const projects = new Map(records.map((r) => [r.id, liveProject(r)]));
  const authorities = new Map(records.map((r) => liveAuthority(r)).filter((a): a is Authority => Boolean(a)).map((a) => [a.id, a]));

  const index = new MiniSearch<{ id: string; docId: string; page: number; text: string }>({
    fields: ["text"],
    storeFields: ["docId", "page", "text"],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  for (const [docId, p] of pages) p.forEach((text, i) => index.add({ id: `${docId}#${i + 1}`, docId, page: i + 1, text }));

  return {
    ...base,
    documents: [...base.documents, ...docs.values()],
    getDocument: (id) => docs.get(id) ?? base.getDocument(id),
    getPage: (id, n) => (pages.has(id) ? pages.get(id)![n - 1] : base.getPage(id, n)),
    pageCount: (id) => (pages.has(id) ? pages.get(id)!.length : base.pageCount(id)),
    getProject: (id) => projects.get(id) ?? base.getProject(id),
    getAuthority: (id) => (id && authorities.get(id)) || base.getAuthority(id),
    search(query, opts) {
      const limit = opts?.limit ?? 6;
      const own = index
        .search(query)
        .filter((r) => !opts?.docIds || opts.docIds.includes(r.docId as string))
        .slice(0, 3)
        .map((r) => ({ docId: r.docId as string, page: r.page as number, score: Math.round(r.score * 100) / 100, snippet: String(r.text).replace(/\s+/g, " ").slice(0, 260) }));
      return [...own, ...base.search(query, opts)].slice(0, limit);
    },
  };
}
