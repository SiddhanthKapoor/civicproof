"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CASE_DOCUMENT_KINDS, CASE_DOCUMENT_LABELS, type PublicCase } from "@/lib/schemas";
import { Button, formatDate } from "@/components/ui";
import { cn } from "@/lib/utils";

const field = "w-full rounded-xl border border-rule-strong bg-card px-3 py-2 text-[14.5px] text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10";

export async function openPrivateFile(caseId: string, docId: string, ownerKey: string) {
  const r = await fetch(`/api/cases/${caseId}/documents/${docId}/file`, { headers: { "x-owner-key": ownerKey } });
  if (!r.ok) return false;
  const url = URL.createObjectURL(await r.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Documents the reporter adds: the RTI reply that comes back, a work order, a completion certificate. */
export function DocumentsPanel({ caseData, ownerKey, onUpdated }: { caseData: PublicCase; ownerKey: string | null; onUpdated: (c: PublicCase) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const docs = caseData.documents ?? [];

  if (!ownerKey) {
    if (!docs.length) return null;
    return (
      <p className="rounded-2xl border border-rule bg-paper-2/60 p-4 text-[13.5px] text-ink-2">
        The reporter has added {docs.length} document{docs.length === 1 ? "" : "s"} to this case. Files stay private; any excerpt quoted from them appears in the evidence, marked as coming from the reporter&apos;s upload.
      </p>
    );
  }

  async function upload(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Choose a PDF or an image.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await fetch(`/api/cases/${caseData.id}/documents`, { method: "POST", headers: { "x-owner-key": ownerKey! }, body: fd });
      const d = await r.json();
      if (!r.ok) {
        setError(d.fields ? Object.values(d.fields).join(" ") : d.error);
        return;
      }
      onUpdated(d.case);
      form.current?.reset();
      setDone(d.document.textPages ? `Added. ${d.document.textPages} page${d.document.textPages === 1 ? "" : "s"} of text are now available to the investigator; run it again to read them.` : "Added. It has no text layer, so it can't be quoted yet.");
    } catch {
      setError("Upload failed; nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
      <p className="text-[14.5px] font-medium">Documents you received</p>
      <p className="mt-0.5 text-[13px] text-ink-3">
        Add the RTI reply, a work order or a completion certificate. The file stays private to you; the investigator can read and quote it, and quotes are marked as coming from your upload.
      </p>
      {docs.length > 0 && (
        <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-ink">{d.title}</p>
                <p className="text-[12px] text-ink-3">
                  {CASE_DOCUMENT_LABELS[d.kind]} · {d.pageCount} page{d.pageCount === 1 ? "" : "s"}
                  {d.textPages ? "" : " · no text layer"} · added {formatDate(d.uploadedAt)}
                </p>
              </div>
              <div className="flex gap-3 text-[12.5px]">
                {d.textPages > 0 && (
                  <Link href={`/cases/${caseData.id}/documents/${d.id}`} className="text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">Read</Link>
                )}
                <button type="button" onClick={() => void openPrivateFile(caseData.id, d.id, ownerKey)} className="text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">Open file</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="text-[13px] text-ink-2 sm:col-span-2">File (PDF, JPEG, PNG · up to 5 MB)
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={cn(field, "mt-1 file:mr-3 file:rounded-full file:border-0 file:bg-paper-3 file:px-3 file:py-1 file:text-[13px]")} />
        </label>
        <label className="text-[13px] text-ink-2">Title
          <input name="title" required minLength={3} maxLength={120} placeholder="e.g. PIO reply dated 2 Oct" className={cn(field, "mt-1")} />
        </label>
        <label className="text-[13px] text-ink-2">Type
          <select name="kind" className={cn(field, "mt-1")} defaultValue="rti_reply">
            {CASE_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{CASE_DOCUMENT_LABELS[k]}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Reading document…" : "Add document"}</Button>
          {error && <p className="text-[13px] text-contradicted" role="alert">{error}</p>}
          {done && <p className="text-[13px] text-verified" role="status">{done}</p>}
        </div>
      </form>
    </div>
  );
}
