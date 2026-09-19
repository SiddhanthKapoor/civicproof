"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import type { Packet } from "@/lib/schemas";
import { packetToText, wordCount } from "@/lib/packet-text";
import { Button, Container, ExternalIcon, buttonClass } from "@/components/ui";
import { UNVERIFIED_CHANNEL, type SubmissionDestination } from "@/lib/submission";
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
  saved: initialSaved,
  notice,
  destinations,
}: {
  caseId: string;
  caseTitle: string;
  demo: boolean;
  investigated: boolean;
  initialKind: Kind;
  packets: Partial<Record<Kind, Packet>> & Record<"complaint" | "rti", Packet>;
  saved: Record<Kind, boolean>;
  /** Shown above the document, e.g. why a first appeal can't be drafted yet. */
  notice?: string;
  /** Where each draft is taken, resolved from the authority directory on the server. */
  destinations: Record<Kind, SubmissionDestination>;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const destination = destinations[kind] ?? { verified: false };
  const [docs, setDocs] = useState(packets);
  const [dirty, setDirty] = useState<Record<Kind, boolean>>({ complaint: false, rti: false, appeal: false });
  const [saved, setSaved] = useState(initialSaved);
  const kinds = (["complaint", "rti", "appeal"] as Kind[]).filter((k) => docs[k]);
  const ownerKey = useStoredOwnerKey(caseId);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // The page renders public drafts. The reporter's saved packets (and drafts with their name and
  // contact filled in) are private, so they are fetched with the owner key.
  useEffect(() => {
    if (!ownerKey) return;
    let cancelled = false;
    fetch(`/api/cases/${caseId}/packet`, { headers: { "x-owner-key": ownerKey }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { packets: Partial<Record<Kind, Packet>>; saved: Kind[] } | null) => {
        if (!d || cancelled) return;
        setDocs((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(d.packets) as Kind[]) if (!dirtyRef.current[k]) next[k] = d.packets[k]!;
          return next;
        });
        setSaved({ complaint: d.saved.includes("complaint"), rti: d.saved.includes("rti"), appeal: d.saved.includes("appeal") });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [caseId, ownerKey]);
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
        headers: { "content-type": "application/json", ...(ownerKey ? { "x-owner-key": ownerKey } : {}) },
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
      setSaved((x) => ({ ...x, [kind]: true }));
      setStatus("Saved to the case. Saved packets are visible only with your owner key.");
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
        {notice && <p className="mt-4 rounded-xl bg-paper-3 px-4 py-3 text-[14px] text-ink-2">{notice}</p>}
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

        {/* WHERE TO SUBMIT — immediately after the packet, because this is the moment a citizen
            needs it. CivicProof names the office and the official channel and stops there: the
            portal is opened, checked and submitted by the person, never by us. */}
        <section aria-labelledby="submit-heading" className="no-print mt-6 rounded-2xl border border-rule-strong bg-card p-5 shadow-card lg:col-start-1">
          <h2 id="submit-heading" className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Where to submit</h2>
          {destination.verified ? (
            <>
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-[150px_1fr]">
                <dt className="text-ink-3">Authority</dt>
                <dd className="text-ink">{destination.authority}</dd>
                <dt className="text-ink-3">Official channel</dt>
                <dd className="text-ink">{destination.channel}</dd>
                <dt className="text-ink-3">Submission method</dt>
                <dd className="text-ink-2">{destination.method}</dd>
              </dl>
              {destination.note && <p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{destination.note}</p>}
              {destination.url && (
                <a href={destination.url} target="_blank" rel="noreferrer" className={cn(buttonClass("primary", "md"), "mt-4 inline-flex items-center gap-1.5")}>
                  Open official portal <ExternalIcon />
                </a>
              )}
              {destination.sourceUrl && (
                <p className="mt-2 text-[12px] text-ink-3">
                  Channel recorded from{" "}
                  <a href={destination.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-rule-strong underline-offset-4 hover:text-accent">
                    the authority&rsquo;s own page
                  </a>
                  . Confirm it is still current before you file.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{UNVERIFIED_CHANNEL}</p>
          )}

          <ol className="mt-4 list-decimal space-y-1 border-t border-rule pt-3 pl-5 text-[13px] text-ink-2">
            <li>Open the official portal yourself.</li>
            <li>Read the draft above and edit anything that is not right.</li>
            <li>Complete the sign-in, CAPTCHA or other verification the portal asks for.</li>
            <li>Paste the complaint or upload the packet, attach your photographs, and submit.</li>
            <li>Come back and record the reference number, so the reply deadline can be tracked.</li>
          </ol>
          <p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
            CivicProof prepares the evidence and complaint. Final submission remains under the citizen&rsquo;s control. It does not
            sign in, answer a CAPTCHA, or send anything on your behalf — that is deliberate, not a missing feature.
          </p>
        </section>

        <aside className="no-print space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-rule bg-card p-4 shadow-card">
            <div className="grid gap-2">
              {/* Named for the thing in front of the reader, so the two ways of taking it away are
                  obvious: paste it into an official form, or carry the whole packet as a file. */}
              <Button onClick={downloadPdf} disabled={busy === "pdf"}>{busy === "pdf" ? "Preparing PDF…" : "Download packet (PDF)"}</Button>
              <Button variant="secondary" onClick={copy}>
                {kind === "complaint" ? "Copy complaint" : kind === "rti" ? "Copy application" : "Copy appeal"}
              </Button>
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
              <li>{kind === "complaint" ? "Attach your photos and check your name and contact details." : kind === "rti" ? "Fill in your name and address, and pay the fee." : "Name the First Appellate Authority and attach a copy of the RTI application."}</li>
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
