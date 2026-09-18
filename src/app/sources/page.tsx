import type { Metadata } from "next";
import Link from "next/link";
import { getCorpus } from "@/lib/corpus";
import { Container, Eyebrow, ExternalIcon, formatDate } from "@/components/ui";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = { title: "Official records", description: "The public documents CivicProof checks every fact against." };

const TYPE: Record<string, string> = {
  official_pdf: "Official PDF",
  official_web: "Official portal record",
  open_data: "Open data",
  audit_report: "Audit report",
  news: "News",
};

export default function SourcesPage() {
  const corpus = getCorpus();
  const citedBy = new Map<string, string[]>();
  for (const p of corpus.projects) for (const d of p.documents) citedBy.set(d, [...(citedBy.get(d) ?? []), p.id]);

  return (
    <Container className="pb-10 pt-10 sm:pt-12">
      <Reveal>
        <Eyebrow>The corpus</Eyebrow>
        <h1 className="mt-3 font-serif text-[40px] leading-[1.05] tracking-[-0.01em] sm:text-[52px]">Official records</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          Every verified fact on CivicProof is a quotation from one of these documents. Each file is stored with its source link, the date
          it was retrieved and its SHA-256, and ingestion fails if a file changes or a curated quotation cannot be found on its page.
        </p>
      </Reveal>

      <div className="mt-10 overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
        <div className="hidden grid-cols-[1fr_160px_90px_120px] gap-4 border-b border-rule bg-paper-2/60 px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.1em] text-ink-3 md:grid">
          <span>Document</span>
          <span>Type</span>
          <span className="text-right">Pages</span>
          <span className="text-right">Retrieved</span>
        </div>
        <ul className="divide-y divide-rule">
          {corpus.documents.map((d) => (
            <li key={d.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_160px_90px_120px] md:items-baseline md:gap-4">
              <div className="min-w-0">
                <Link href={`/sources/${d.id}`} className="text-[15.5px] font-medium leading-snug text-ink hover:text-accent">{d.title}</Link>
                <p className="mt-1 text-[13px] text-ink-3">{d.publisher}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-ink-3">
                  <span>sha256 {d.sha256?.slice(0, 16)}…</span>
                  {citedBy.get(d.id) && <span>{citedBy.get(d.id)!.length} project{citedBy.get(d.id)!.length === 1 ? "" : "s"}</span>}
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans text-[12px] text-ink-2 hover:text-accent">
                      Source <ExternalIcon />
                    </a>
                  )}
                </p>
              </div>
              <span className="text-[13px] text-ink-2">{TYPE[d.sourceType] ?? d.sourceType}</span>
              <span className="tnum text-[13px] text-ink-2 md:text-right">{d.pageCount}</span>
              <span className="text-[13px] text-ink-2 md:text-right">{formatDate(d.retrievedAt)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-rule p-5">
          <p className="text-[14px] font-medium">Projects in the corpus</p>
          <ul className="mt-3 space-y-2">
            {corpus.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="text-[14px] leading-snug text-ink-2 hover:text-accent">{p.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-rule p-5 text-[14px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">Use and licences</p>
          <p className="mt-2">
            Government records are quoted and linked for public-interest verification, with attribution. OMMAS reports carry an NRRDA
            notice restricting republication; they are included only so quotations can be checked, and each links to the official portal.
            Map alignments for city roads are © OpenStreetMap contributors (ODbL); PMGSY alignments are from GeoSadak (GODL-India).
          </p>
        </div>
      </div>
    </Container>
  );
}
