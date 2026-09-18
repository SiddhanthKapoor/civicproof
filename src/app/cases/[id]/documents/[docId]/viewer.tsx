"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CaseDocument } from "@/lib/schemas";
import { CASE_DOCUMENT_LABELS } from "@/lib/schemas";
import { locateExcerpt } from "@/lib/locate";
import { useStoredOwnerKey } from "@/lib/use-owner-key";
import { Button, Container, formatDate } from "@/components/ui";
import { openPrivateFile } from "../../documents-panel";
import { cn } from "@/lib/utils";

export function PrivateDocumentViewer({ caseId, docId }: { caseId: string; docId: string }) {
  const ownerKey = useStoredOwnerKey(caseId);
  const search = useSearchParams();
  const [data, setData] = useState<{ document: CaseDocument; pages: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => Math.max(1, Number(search.get("page")) || 1));
  const q = search.get("q") ?? undefined;

  useEffect(() => {
    if (!ownerKey) return;
    let cancelled = false;
    fetch(`/api/cases/${caseId}/documents/${docId}`, { headers: { "x-owner-key": ownerKey } })
      .then(async (r) => {
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(d.error);
        else setData(d);
      })
      .catch(() => !cancelled && setError("Couldn't load the document."));
    return () => {
      cancelled = true;
    };
  }, [caseId, docId, ownerKey]);

  const text = data?.pages[page - 1] ?? "";
  const hit = useMemo(() => (q && text ? locateExcerpt(text, q) : null), [q, text]);

  return (
    <Container className="pb-12 pt-8 sm:pt-10">
      <nav className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="Breadcrumb">
        <Link href="/cases" className="hover:text-ink">Cases</Link>
        <span aria-hidden>/</span>
        <Link href={`/cases/${caseId}`} className="font-mono hover:text-ink">{caseId}</Link>
        <span aria-hidden>/</span>
        <span className="text-ink-2">Reporter document</span>
      </nav>
      {!ownerKey && (
        <p className="mt-8 max-w-xl rounded-2xl border border-rule bg-paper-2/60 p-5 text-[14.5px] text-ink-2">
          This document was added by the person who filed the report and is visible only to them. Quoted excerpts appear in the case&apos;s evidence.
        </p>
      )}
      {error && <p className="mt-8 rounded-xl bg-contradicted-soft px-4 py-3 text-[14px] text-contradicted">{error}</p>}
      {data && (
        <>
          <h1 className="mt-4 max-w-4xl font-serif text-[30px] leading-[1.1] sm:text-[40px]">{data.document.title}</h1>
          <p className="mt-2 text-[14px] text-ink-2">
            {CASE_DOCUMENT_LABELS[data.document.kind]} · uploaded by you on {formatDate(data.document.uploadedAt)} · SHA-256 <span className="font-mono text-[12.5px]">{data.document.sha256.slice(0, 16)}…</span>
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[13px] text-ink-2">Page {page} of {data.pages.length}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= data.pages.length} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              <Button size="sm" variant="ghost" onClick={() => void openPrivateFile(caseId, docId, ownerKey!)}>Open file</Button>
            </div>
          </div>
          {q && (
            <p className={cn("mt-3 rounded-xl px-4 py-2.5 text-[13.5px]", hit ? "bg-verified-soft text-verified" : "bg-partial-soft text-partial")}>
              {hit ? "The quoted excerpt is highlighted below." : "The quoted excerpt was not found on this page."}
            </p>
          )}
          <article className="mt-4 rounded-[6px] border border-rule bg-white px-5 py-6 shadow-card sm:px-8 sm:py-8">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-ink-2">
              {hit ? (
                <>
                  {text.slice(0, hit[0])}
                  <mark className="mark-strong rounded-[2px] px-0.5 text-ink">{text.slice(hit[0], hit[1])}</mark>
                  {text.slice(hit[1])}
                </>
              ) : (
                text || "This page has no extractable text."
              )}
            </pre>
          </article>
        </>
      )}
    </Container>
  );
}
