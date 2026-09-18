"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import type { Packet } from "@/lib/schemas";
import { packetToText, wordCount } from "@/lib/packet-text";
import { Button, Container } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useStoredOwnerKey } from "@/lib/use-owner-key";

type Kind = "complaint" | "rti" | "appeal";
const KIND_TITLE: Record<Kind, string> = { complaint: "Complaint packet", rti: "RTI application", appeal: "RTI first appeal" };
const KIND_TAB: Record<Kind, string> = { complaint: "Complaint", rti: "RTI draft", appeal: "First appeal" };

function AutoTextarea({ value, onChange, className, label }: { value: string; onChange: (v: string) => void; className?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-lg border border-transparent bg-transparent px-2 py-1 -mx-2 transition-colors hover:border-rule focus:border-accent/60 focus:bg-card focus:outline-none",
        className,
      )}
    />
  );
}

export function PacketEditor({
  caseId,
  caseTitle,
  demo,
  investigated,
  initialKind,
  packets,
  saved,
}: {
  caseId: string;
  caseTitle: string;
  demo: boolean;
  investigated: boolean;
  initialKind: Kind;
  packets: Partial<Record<Kind, Packet>> & Record<"complaint" | "rti", Packet>;
  saved: Record<Kind, boolean>;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [docs, setDocs] = useState(packets);
  const [dirty, setDirty] = useState<Record<Kind, boolean>>({ complaint: false, rti: false, appeal: false });
  const kinds = (["complaint", "rti", "appeal"] as Kind[]).filter((k) => docs[k]);
  const ownerKey = useStoredOwnerKey(caseId);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const doc = docs[kind] ?? docs.complaint;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("kind", kind);
    history.replaceState(null, "", url);
  }, [kind]);

  const update = (patch: Partial<Packet>) => {
    setDocs((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }));
    setDirty((d) => ({ ...d, [kind]: true }));
    setStatus(null);
  };

  const edit = () => ({ kind, addressedTo: doc.addressedTo, subject: doc.subject, sections: doc.sections });

  async function copy() {
    await navigator.clipboard.writeText(packetToText(doc)).catch(() => undefined);
    setStatus("Copied to the clipboard.");
  }

  async function downloadPdf() {
    setBusy("pdf");
    setStatus(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/packet/pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, edit: edit() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "PDF failed");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `civicproof-${caseId.toLowerCase()}-${kind}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      const sha = r.headers.get("x-civicproof-sha256");
      setStatus(`PDF downloaded${sha ? ` · SHA-256 ${sha.slice(0, 12)}…` : ""}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "The PDF could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const r = await fetch(`/api/cases/${caseId}/packet`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-owner-key": ownerKey ?? "" },
        body: JSON.stringify({ kind, edit: edit() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus(d.error);
        return;
      }
      setDirty((x) => ({ ...x, [kind]: false }));
      setStatus("Saved to the case.");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setBusy("regen");
    try {
      const r = await fetch(`/api/cases/${caseId}/packet`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-owner-key": ownerKey ?? "" },
        body: JSON.stringify({ kind }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus(d.error);
        return;
      }
      setDocs((x) => ({ ...x, [kind]: d.packet }));
      setDirty((x) => ({ ...x, [kind]: false }));
      setStatus(d.persisted ? "A fresh draft was generated from the current evidence and saved to the case." : "A fresh draft was generated from the current evidence.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-16">
      <Container className="no-print pt-8 sm:pt-10">
        <nav className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="Breadcrumb">
          <Link href="/cases" className="hover:text-ink">Cases</Link>
          <span aria-hidden>/</span>
          <Link href={`/cases/${caseId}`} className="font-mono hover:text-ink">{caseId}</Link>
          <span aria-hidden>/</span>
          <span className="text-ink-2">Packet</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[36px] leading-tight tracking-[-0.01em] sm:text-[44px]">{KIND_TITLE[kind]}</h1>
            <p className="mt-1 max-w-2xl text-[14.5px] text-ink-2">For “{caseTitle}”. Everything is editable. Nothing is sent from here.</p>
          </div>
          <div className="relative flex rounded-full bg-paper-3 p-1" role="tablist" aria-label="Document type">
            {kinds.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={cn("relative h-9 rounded-full px-4 text-[14px] transition-colors", kind === k ? "text-ink" : "text-ink-2 hover:text-ink")}
              >
                {kind === k && <motion.span layoutId="packet-tab" className="absolute inset-0 -z-10 rounded-full bg-card shadow-card" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
                {KIND_TAB[k]}
              </button>
            ))}
          </div>
        </div>
        {!investigated && (
          <p className="mt-4 rounded-xl bg-partial-soft px-4 py-3 text-[14px] text-partial">
            This case hasn&apos;t been investigated yet, so the draft contains only the report. <Link href={`/cases/${caseId}`} className="underline">Run the investigation</Link> first.
          </p>
        )}
      </Container>

      <Container className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <motion.article
          key={kind}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative rounded-[6px] border border-rule bg-white px-6 py-10 shadow-lift sm:px-14 sm:py-14"
          aria-label="Editable document"
        >
          {demo && (
            <p className="no-print absolute right-4 top-4 rounded-full border border-dashed border-ink/25 px-2.5 py-0.5 text-[11.5px] text-ink-3">Demo report</p>
          )}
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            CivicProof · {KIND_TITLE[kind]} · draft · {caseId}
          </p>
          <div className="mt-6 space-y-1 font-sans text-[13.5px] text-ink-2">
            <div className="flex gap-2">
              <span className="w-10 shrink-0 pt-1 text-ink-3">To</span>
              <AutoTextarea label="Addressed to" value={doc.addressedTo} onChange={(v) => update({ addressedTo: v })} className="text-[14px] text-ink" />
            </div>
          </div>
          <AutoTextarea label="Subject" value={doc.subject} onChange={(v) => update({ subject: v })} className="mt-5 font-serif text-[22px] leading-snug text-ink" />
          <div className="mt-6 space-y-6">
            {doc.sections.map((s, i) => (
              <section key={s.id}>
                <h2 className="font-sans text-[11.5px] font-semibold uppercase tracking-[0.12em] text-accent">{s.heading}</h2>
                <AutoTextarea
                  label={s.heading}
                  value={s.body}
                  onChange={(v) => update({ sections: doc.sections.map((x, j) => (j === i ? { ...x, body: v } : x)) })}
                  className={cn("mt-1.5 font-serif text-[15.5px] leading-[1.65] text-ink", s.id === "evidence" && "font-mono text-[12px] leading-relaxed text-ink-2")}
                />
                {kind === "rti" && s.id === "information" && (
                  <p className="no-print mt-1 font-mono text-[11.5px] text-ink-3">{wordCount(s.body)} words</p>
                )}
              </section>
            ))}
          </div>
          <p className="mt-10 border-t border-rule pt-4 font-sans text-[12px] italic leading-relaxed text-ink-3">{doc.disclaimer}</p>
        </motion.article>

        <aside className="no-print space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
            <div className="grid gap-2">
              <Button onClick={downloadPdf} disabled={busy === "pdf"}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</Button>
              <Button variant="secondary" onClick={copy}>Copy as text</Button>
              <Button variant="ghost" onClick={() => window.print()}>Print</Button>
            </div>
            <div className="mt-3 border-t border-rule pt-3">
              {ownerKey ? (
                <Button variant="secondary" size="sm" className="w-full" onClick={save} disabled={!dirty[kind] || busy === "save"}>
                  {busy === "save" ? "Saving…" : dirty[kind] ? "Save edits to the case" : saved[kind] ? "Saved" : "No edits to save"}
                </Button>
              ) : (
                <p className="text-[12.5px] text-ink-3">Edits stay in this tab. Only the reporter can save them to the case, but anyone can download or copy their version.</p>
              )}
              <button type="button" onClick={regenerate} disabled={busy === "regen"} className="mt-2 w-full text-[12.5px] text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-ink">
                Rebuild the draft from current evidence
              </button>
            </div>
            {status && <p className="mt-3 text-[12.5px] text-ink-2" role="status">{status}</p>}
          </div>
          <div className="rounded-2xl border border-rule bg-paper-2/60 p-4">
            <p className="text-[13px] font-medium text-ink">Before you send it</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink-2">
              <li>Check the addressee and the office’s current channel.</li>
              <li>Read every fact against its numbered source.</li>
              <li>{kind === "complaint" ? "Attach your photos and add your contact details." : kind === "rti" ? "Fill in your name and address, and pay the fee." : "Name the First Appellate Authority and attach a copy of the RTI application."}</li>
              <li>Record the reference number on the case page.</li>
            </ul>
            <Link href={`/cases/${caseId}#tracking`} className="mt-3 inline-block text-[13px] font-medium text-ink underline decoration-rule-strong underline-offset-4">
              Record a submission →
            </Link>
          </div>
        </aside>
      </Container>
    </div>
  );
}
