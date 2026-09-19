/**
 * The source corpus: official documents (as extracted page text), the project registry
 * used for location matching, and the authority directory used for escalation.
 *
 * Built by `npm run ingest` from corpus/manifest.json + corpus/documents/*, which checks each
 * file's sha256 against the manifest and each curated excerpt against the page text.
 */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { LatLng, SourceDocument } from "@/lib/schemas";
import { distanceToGeometry } from "@/lib/geo";
import type { CorpusReader } from "@/lib/agent/verifier";
import {
  AuthoritySchema,
  ManifestSchema,
  PagesFileSchema,
  ProjectSchema,
  type Authority,
  type Project,
} from "./types";

export type { Authority, Project } from "./types";

interface Chunk {
  id: string;
  docId: string;
  page: number;
  text: string;
}

export interface Corpus extends CorpusReader {
  documents: SourceDocument[];
  projects: Project[];
  authorities: Authority[];
  getProject(id: string): Project | undefined;
  getAuthority(id: string | undefined): Authority | undefined;
  search(query: string, opts?: { docIds?: string[]; limit?: number }): Array<{ docId: string; page: number; score: number; snippet: string }>;
  projectsNear(p: LatLng, radiusM: number): Array<{ project: Project; distanceM: number }>;
  /**
   * Projects whose work/package identifier equals this code. The identifier is what *establishes*
   * identity, so this is an exact lookup against the registry, never a fuzzy search. A code may
   * legitimately match several projects: PMGSY package ids repeat per block.
   */
  findProjectsByCode(code: string): Project[];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function snippetAround(text: string, terms: string[], width = 260): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    pos = lower.indexOf(t.toLowerCase());
    if (pos >= 0) break;
  }
  const start = Math.max(0, pos < 0 ? 0 : pos - width / 3);
  const s = text.slice(start, start + width).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + s + (start + width < text.length ? "…" : "");
}

export function loadCorpus(root = path.join(process.cwd(), "corpus")): Corpus {
  const manifest = ManifestSchema.parse(readJson(path.join(root, "manifest.json")));
  const geo = readJson(path.join(root, "geometry", "projects.geojson")) as {
    features: Array<{ properties: { project: string }; geometry: Project["geometry"] }>;
  };
  const geomById = new Map(geo.features.map((f) => [f.properties.project, f.geometry]));
  const projects = ProjectSchema.array()
    .parse(readJson(path.join(root, "projects.json")))
    .map((p) => ({ ...p, geometry: p.geometry ?? geomById.get(p.id) }));
  // A project may lack geometry only if its record says so (found by name, not by location).
  const missingGeometry = projects.filter((p) => !p.geometry && p.geometrySource.kind !== "none").map((p) => p.id);
  if (missingGeometry.length) throw new Error(`Projects without geometry: ${missingGeometry.join(", ")}`);
  const authorities = AuthoritySchema.array().parse(readJson(path.join(root, "authorities.json")));
  const pagesFile = PagesFileSchema.parse(readJson(path.join(root, "generated", "pages.json")));

  const docs = new Map(manifest.documents.map((d) => [d.id, { ...d, pageCount: pagesFile[d.id]?.pages.length ?? 0 }]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // Registry index: work/package identifier -> projects. Built from the curated project_id fact,
  // which ingest has already verified verbatim against its source page, and from the slug as a
  // fallback. 778 of 779 projects carry a code; 53 codes match more than one project.
  const codeIndex = new Map<string, Project[]>();
  const addCode = (raw: string | undefined, p: Project) => {
    const code = (raw ?? "").trim().toUpperCase();
    if (!code) return;
    const at = codeIndex.get(code);
    if (at) {
      if (!at.includes(p)) at.push(p);
    } else codeIndex.set(code, [p]);
  };
  for (const p of projects) {
    addCode(p.reference.find((r) => r.field === "project_id")?.value, p);
    addCode(p.id.split("-").pop(), p);
  }
  const authorityMap = new Map(authorities.map((a) => [a.id, a]));

  // Page-level chunks, split further if a page is very long so snippets stay relevant.
  const chunks: Chunk[] = [];
  for (const [docId, { pages }] of Object.entries(pagesFile)) {
    pages.forEach((text, i) => {
      const parts = text.length > 2400 ? text.match(/[\s\S]{1,2000}(?:\s|$)/g) ?? [text] : [text];
      parts.forEach((part, j) => chunks.push({ id: `${docId}#${i + 1}#${j}`, docId, page: i + 1, text: part }));
    });
  }
  const index = new MiniSearch<Chunk>({
    fields: ["text"],
    storeFields: ["docId", "page", "text"],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  index.addAll(chunks);

  return {
    documents: [...docs.values()],
    projects,
    authorities,
    getDocument: (id) => docs.get(id),
    getPage: (id, page) => pagesFile[id]?.pages[page - 1],
    pageCount: (id) => pagesFile[id]?.pages.length ?? 0,
    getProject: (id) => projectMap.get(id),
    getAuthority: (id) => (id ? authorityMap.get(id) : undefined),
    search(query, opts) {
      const limit = opts?.limit ?? 6;
      const terms = query.split(/\s+/).filter((t) => t.length > 2);
      const results = index.search(query, {
        filter: opts?.docIds ? (r) => opts.docIds!.includes(r.docId as string) : undefined,
      });
      const seen = new Set<string>();
      const out: Array<{ docId: string; page: number; score: number; snippet: string }> = [];
      for (const r of results) {
        const key = `${r.docId}#${r.page}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ docId: r.docId as string, page: r.page as number, score: Math.round(r.score * 100) / 100, snippet: snippetAround(r.text as string, terms) });
        if (out.length >= limit) break;
      }
      return out;
    },
    // A copy: the index is shared for the process lifetime, and a caller that sorted or spliced
    // the result in place would silently reorder the registry for everyone after it.
    findProjectsByCode: (code) => [...(codeIndex.get(code.trim().toUpperCase()) ?? [])],
    projectsNear(p, radiusM) {
      return projects
        .filter((project) => project.geometry)
        .map((project) => ({ project, distanceM: distanceToGeometry(p, project.geometry!) }))
        .filter((x) => x.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM);
    },
  };
}

let cached: Corpus | undefined;
export function getCorpus(): Corpus {
  if (!cached) cached = loadCorpus();
  return cached;
}
