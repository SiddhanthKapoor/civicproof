import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCorpus } from "@/lib/corpus";
import { locateExcerpt } from "@/lib/locate";
import { buttonClass, Container, ExternalIcon, formatDate } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ScrollToHit } from "@/components/scroll-to-hit";

export async function generateMetadata(props: PageProps<"/sources/[docId]">): Promise<Metadata> {
  const { docId } = await props.params;
  const d = getCorpus().getDocument(docId);
  return { title: d ? d.title : "Document not found" };
}

export default async function DocumentPage(props: PageProps<"/sources/[docId]">) {
  const { docId } = await props.params;
  const sp = await props.searchParams;
  const corpus = getCorpus();
  const doc = corpus.getDocument(docId);
  if (!doc) notFound();
  const pages = corpus.pageCount(docId);
  const page = Math.min(Math.max(1, Number(sp.page) || 1), Math.max(1, pages));
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const text = corpus.getPage(docId, page) ?? "";
  const hit = q ? locateExcerpt(text, q) : null;
  const projects = corpus.projects.filter((p) => p.documents.includes(docId));
  const href = (n: number) => `/sources/${docId}?page=${n}${q && n === page ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <Container className="pb-12 pt-8 sm:pt-10">
      <nav className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="Breadcrumb">
        <Link href="/sources" className="hover:text-ink">Records</Link>
        <span aria-hidden>/</span>
        <span className="truncate text-ink-2">{doc.id}</span>
      </nav>
      <h1 className="mt-4 max-w-4xl font-serif text-[30px] leading-[1.1] tracking-[-0.01em] sm:text-[40px]">{doc.title}</h1>
      <p className="mt-2 text-[14px] text-ink-2">{doc.publisher}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[13px] text-ink-2">
              Page {page} of {pages}
            </p>
            <div className="flex items-center gap-2">
              <Link aria-disabled={page <= 1} href={href(Math.max(1, page - 1))} className={cn(buttonClass("secondary", "sm"), page <= 1 && "pointer-events-none opacity-40")}>← Previous</Link>
              <Link aria-disabled={page >= pages} href={href(Math.min(pages, page + 1))} className={cn(buttonClass("secondary", "sm"), page >= pages && "pointer-events-none opacity-40")}>Next →</Link>
            </div>
          </div>
          {hit && <ScrollToHit />}
          {q && (
            <p className={cn("mt-3 rounded-xl px-4 py-2.5 text-[13.5px]", hit ? "bg-verified-soft text-verified" : "bg-partial-soft text-partial")}>
              {hit ? "The quoted excerpt is highlighted below, exactly where it appears in the extracted text." : "The quoted excerpt was not found verbatim on this page."}
            </p>
          )}
          <article id={`p${page}`} className="mt-4 rounded-[6px] border border-rule bg-white px-5 py-6 shadow-card sm:px-8 sm:py-8">
            {text.trim() ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-ink-2">
                {hit ? (
                  <>
                    {text.slice(0, hit[0])}
                    <mark id="hit" className="mark-strong rounded-[2px] px-0.5 text-ink">{text.slice(hit[0], hit[1])}</mark>
                    {text.slice(hit[1])}
                  </>
                ) : (
                  text
                )}
              </pre>
            ) : (
              <p className="text-[14px] text-ink-3">This page has no text layer (it is likely an image). It cannot be quoted or verified.</p>
            )}
          </article>
          <p className="mt-3 text-[12.5px] text-ink-3">
            Text as extracted by CivicProof&apos;s ingest step. Structured records (portal API responses) are shown as field: value lines.
          </p>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <dl className="space-y-3 rounded-2xl border border-rule bg-card p-4 text-[13px] shadow-card">
            <div>
              <dt className="text-ink-3">Retrieved</dt>
              <dd className="text-ink">{formatDate(doc.retrievedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">SHA-256 of the stored file</dt>
              <dd className="break-all font-mono text-[11.5px] text-ink">{doc.sha256}</dd>
            </div>
            {doc.url && (
              <div>
                <dt className="text-ink-3">Source</dt>
                <dd>
                  <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-ink underline decoration-rule-strong underline-offset-4 hover:text-accent">
                    Open the original <ExternalIcon />
                  </a>
                </dd>
              </div>
            )}
            {doc.notes && (
              <div>
                <dt className="text-ink-3">Notes</dt>
                <dd className="text-ink-2">{doc.notes}</dd>
              </div>
            )}
            {doc.licence && (
              <div>
                <dt className="text-ink-3">Licence</dt>
                <dd className="text-ink-2">{doc.licence}</dd>
              </div>
            )}
          </dl>
          {projects.length > 0 && (
            <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
              <p className="text-[13px] text-ink-3">Projects using this record</p>
              <ul className="mt-2 space-y-1.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="text-[13.5px] leading-snug text-ink hover:text-accent">{p.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pages > 1 && (
            <form action={`/sources/${docId}`} className="rounded-2xl border border-rule bg-card p-4 shadow-card">
              <label className="text-[13px] text-ink-3" htmlFor="jump">Go to page</label>
              <div className="mt-2 flex gap-2">
                <input id="jump" name="page" type="number" min={1} max={pages} defaultValue={page} className="w-24 rounded-lg border border-rule-strong bg-card px-2.5 py-1.5 text-[14px]" />
                <button className={buttonClass("secondary", "sm")}>Go</button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </Container>
  );
}
