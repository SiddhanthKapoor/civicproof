/**
 * Corpus ingestion:  npm run ingest
 *
 *  1. For every document in corpus/manifest.json, checks the file's SHA-256 against the manifest.
 *  2. Extracts text per page (PDF via unpdf; official JSON API responses and CSV datasets are
 *     rendered deterministically into text pages) → corpus/generated/pages.json
 *  3. Verifies every curated reference excerpt in corpus/projects.json against that page text,
 *     using the same verifier the agent uses. Any excerpt that is not verbatim fails the build.
 *
 * Nothing in the corpus can reach the UI as "verified" unless it passes step 3.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanPage, pdfPages as extractPdfPages } from "../src/lib/pdf-text";
import { ManifestSchema, ProjectSchema, AuthoritySchema } from "../src/lib/corpus/types";
import { verifyClaim, type CorpusReader } from "../src/lib/agent/verifier";
import { bbmpWorkOrderPages, jsonPages, ommasPages, redactContacts, type OmmasLayout } from "../src/lib/records/render";

const ROOT = path.join(process.cwd(), "corpus");

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function pdfPages(buf: Buffer): Promise<string[]> {
  return extractPdfPages(new Uint8Array(buf));
}

/** Official JSON API responses are rendered by the same code the live-record fetchers use. */
function jsonPagesFromFile(buf: Buffer, opts: { keys?: string[] } = {}): string[] {
  return jsonPages(JSON.parse(buf.toString("utf8")), opts);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Renders CSV rows as "Row N — Column: value; …", 40 rows per page. Optional row filter. */
function csvPages(buf: Buffer, filter?: { column: string; includes: string[] }): string[] {
  const [header, ...rows] = parseCsv(buf.toString("utf8"));
  const col = filter ? header.indexOf(filter.column) : -1;
  const kept = rows
    .map((r, i) => ({ r, n: i + 2 }))
    .filter(({ r }) => r.some((c) => c.trim() !== ""))
    .filter(({ r }) => !filter || (col >= 0 && filter.includes.some((x) => (r[col] ?? "").toLowerCase().includes(x.toLowerCase()))));
  const lines = kept.map(({ r, n }) => `Row ${n} — ` + header.map((h, i) => `${h.trim()}: ${(r[i] ?? "").trim()}`).filter((x) => !x.endsWith(": ")).join("; "));
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += 40) pages.push(lines.slice(i, i + 40).join("\n"));
  return pages;
}

function htmlPages(buf: Buffer): string[] {
  const text = buf
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|tr|li|h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
  const clean = cleanPage(text);
  const pages: string[] = [];
  for (let i = 0; i < clean.length; i += 3500) pages.push(clean.slice(i, i + 3500));
  return pages;
}

async function main() {
  const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(ROOT, "manifest.json"), "utf8")));
  const projects = ProjectSchema.array().parse(JSON.parse(await fs.readFile(path.join(ROOT, "projects.json"), "utf8")));
  AuthoritySchema.array().parse(JSON.parse(await fs.readFile(path.join(ROOT, "authorities.json"), "utf8")));
  const extraction = JSON.parse(await fs.readFile(path.join(ROOT, "extraction.json"), "utf8").catch(() => "{}")) as Record<
    string,
    { json?: { keys?: string[] }; csv?: { column: string; includes: string[] }; ommas?: OmmasLayout; bbmpWorkOrders?: boolean }
  >;

  const pages: Record<string, { sha256: string; pages: string[] }> = {};
  let failures = 0;

  for (const doc of manifest.documents) {
    if (!doc.file) continue;
    const file = path.join(ROOT, "documents", doc.file);
    const buf = await fs.readFile(file);
    const hash = sha256(buf);
    if (doc.sha256 && doc.sha256 !== hash) {
      console.error(`✗ ${doc.id}: sha256 mismatch (manifest ${doc.sha256.slice(0, 12)}…, file ${hash.slice(0, 12)}…)`);
      failures++;
      continue;
    }
    const ext = path.extname(doc.file).toLowerCase();
    let p: string[];
    if (ext === ".pdf") p = await pdfPages(buf);
    else if (ext === ".json") p = jsonPagesFromFile(buf, extraction[doc.id]?.json);
    else if (ext === ".csv" && extraction[doc.id]?.ommas) p = ommasPages(buf.toString("utf8"), extraction[doc.id].ommas!);
    else if (ext === ".csv" && extraction[doc.id]?.bbmpWorkOrders) p = bbmpWorkOrderPages(buf.toString("utf8"));
    else if (ext === ".csv") p = csvPages(buf, extraction[doc.id]?.csv);
    else if (ext === ".html" || ext === ".htm") p = htmlPages(buf);
    else p = [cleanPage(buf.toString("utf8"))];
    // Pages are shown publicly on /sources: drop officials' phone numbers and emails the portals print.
    p = p.map(redactContacts);
    const empty = p.filter((x) => x.length < 20).length;
    pages[doc.id] = { sha256: hash, pages: p };
    console.log(`✓ ${doc.id}: ${p.length} page${p.length === 1 ? "" : "s"}${empty ? ` (${empty} with no text layer)` : ""} · ${hash.slice(0, 12)}`);
  }

  const docs = new Map(manifest.documents.map((d) => [d.id, d]));
  const reader: CorpusReader = {
    getDocument: (id) => docs.get(id),
    getPage: (id, n) => pages[id]?.pages[n - 1],
    pageCount: (id) => pages[id]?.pages.length ?? 0,
  };

  for (const project of projects) {
    for (const docId of project.documents) {
      if (!docs.has(docId)) {
        console.error(`✗ ${project.id}: unknown document ${docId}`);
        failures++;
      }
    }
    for (const ref of project.reference) {
      const r = verifyClaim({ ...ref, origin: "official_record" }, reader, "ingest");
      if (r.claim.verification !== "verified") {
        console.error(`✗ ${project.id} · ${ref.field}: ${r.claim.verification} — ${[...r.rejections, ...r.evidence.map((e) => e.checkNote)].join(" | ")}`);
        failures++;
      } else {
        console.log(`  ✓ ${project.id} · ${ref.field}: "${ref.value ?? ref.text}"`);
      }
    }
  }

  await fs.mkdir(path.join(ROOT, "generated"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "generated", "pages.json"), JSON.stringify(pages));
  const total = Object.values(pages).reduce((s, d) => s + d.pages.length, 0);
  console.log(`\n${Object.keys(pages).length} documents, ${total} pages → corpus/generated/pages.json`);
  if (failures) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed. Fix corpus/projects.json or the manifest.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
