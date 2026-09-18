/**
 * Extends the shared records corpus with one case's reporter-supplied documents, so the
 * investigator can search and quote them with the same tools. They are marked as user uploads,
 * which the verifier caps at "partially verified": the quote is in the file, but the file's
 * authenticity is not something CivicProof can check.
 */
import MiniSearch from "minisearch";
import type { CaseDocument, SourceDocument } from "@/lib/schemas";
import { CASE_DOCUMENT_LABELS } from "@/lib/schemas";
import type { Corpus } from "./index";

export function withCaseDocuments(base: Corpus, caseId: string, docs: Array<{ doc: CaseDocument; pages: string[] }>): Corpus {
  if (!docs.length) return base;
  const meta = new Map<string, SourceDocument>();
  const pages = new Map<string, string[]>();
  for (const { doc, pages: p } of docs) {
    meta.set(doc.id, {
      id: doc.id,
      title: `${doc.title} (${CASE_DOCUMENT_LABELS[doc.kind]}, uploaded by the reporter)`,
      publisher: "Uploaded by the reporter",
      sourceType: "user_upload",
      // In-app, owner-only viewer (the file itself is private).
      url: `/cases/${caseId}/documents/${doc.id}`,
      retrievedAt: doc.uploadedAt.slice(0, 10),
      sha256: doc.sha256,
      pageCount: p.length,
      notes: `Case ${caseId}. Authenticity not checked by CivicProof.`,
    });
    pages.set(doc.id, p);
  }
  const index = new MiniSearch<{ id: string; docId: string; page: number; text: string }>({
    fields: ["text"],
    storeFields: ["docId", "page", "text"],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  for (const [docId, p] of pages) p.forEach((text, i) => index.add({ id: `${docId}#${i + 1}`, docId, page: i + 1, text }));

  return {
    ...base,
    documents: [...base.documents, ...meta.values()],
    getDocument: (id) => meta.get(id) ?? base.getDocument(id),
    getPage: (id, n) => (pages.has(id) ? pages.get(id)![n - 1] : base.getPage(id, n)),
    pageCount: (id) => (pages.has(id) ? pages.get(id)!.length : base.pageCount(id)),
    search(query, opts) {
      const limit = opts?.limit ?? 6;
      const own = index
        .search(query)
        .slice(0, 3)
        .map((r) => ({ docId: r.docId as string, page: r.page as number, score: Math.round(r.score * 100) / 100, snippet: String(r.text).replace(/\s+/g, " ").slice(0, 260) }));
      return [...own, ...base.search(query, opts)].slice(0, limit);
    },
  };
}
