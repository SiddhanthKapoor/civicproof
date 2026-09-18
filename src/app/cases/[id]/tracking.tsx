"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { STATUS_LABELS, type CaseStatus, type PublicCase, type TimelineEvent } from "@/lib/schemas";
import { Button, formatDate, formatDateTime } from "@/components/ui";
import { cn } from "@/lib/utils";

const TODAY = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const ACTOR: Record<TimelineEvent["actor"], string> = { reporter: "Reporter", agent: "Investigator", system: "CivicProof" };

function daysUntil(iso: string) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(TODAY() + "T00:00:00Z")) / 86400000);
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <ol className="relative space-y-0 border-l border-rule pl-6">
      {sorted.map((e) => {
        const due = e.followUpDate ? daysUntil(e.followUpDate) : undefined;
        const important = e.type === "complaint_submitted" || e.type === "response_received" || e.type === "status_changed";
        return (
          <li key={e.id} className="relative pb-6 last:pb-0">
            <span className={cn("absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-paper", important ? "bg-ink" : e.actor === "agent" ? "bg-accent" : "bg-rule-strong")} aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-[14.5px] font-medium text-ink">{e.summary}</p>
              {e.toStatus && <span className="text-[13px] text-ink-3">→ {STATUS_LABELS[e.toStatus]}</span>}
            </div>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {formatDateTime(e.at)} · {ACTOR[e.actor]}
              {e.date && ` · dated ${formatDate(e.date)}`}
            </p>
            {(e.channel || e.referenceNumber) && (
              <p className="mt-1.5 text-[13.5px] text-ink-2">
                {e.channel && <>Channel: <span className="text-ink">{e.channel}</span></>}
                {e.channel && e.referenceNumber && " · "}
                {e.referenceNumber && <>Reference: <span className="font-mono text-ink">{e.referenceNumber}</span></>}
              </p>
            )}
            {e.notes && <p className="mt-1.5 max-w-2xl whitespace-pre-line text-[13.5px] text-ink-2">{e.notes}</p>}
            {e.followUpDate && (
              <p className={cn("mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[12px]", due !== undefined && due < 0 ? "bg-contradicted-soft text-contradicted" : "bg-paper-3 text-ink-2")}>
                {e.type === "complaint_submitted" ? "Follow up by" : "Follow-up"} {formatDate(e.followUpDate)}
                {due !== undefined && (due < 0 ? ` · ${-due} days overdue` : due === 0 ? " · today" : ` · in ${due} days`)}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type FormKind = "complaint_submitted" | "response_received" | "follow_up_scheduled" | "note" | "status_changed";

const FORMS: Array<{ kind: FormKind; label: string }> = [
  { kind: "complaint_submitted", label: "Record a submission" },
  { kind: "response_received", label: "Record a response" },
  { kind: "follow_up_scheduled", label: "Schedule a follow-up" },
  { kind: "note", label: "Add a note" },
  { kind: "status_changed", label: "Change status" },
];

const field =
  "w-full rounded-xl border border-rule-strong bg-card px-3 py-2 text-[14.5px] text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10";

export function TrackingPanel({
  caseData,
  ownerKey,
  onUpdated,
  onOwnerKey,
}: {
  caseData: PublicCase;
  ownerKey: string | null;
  onUpdated: (c: PublicCase) => void;
  onOwnerKey: (key: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<FormKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const channels = [...new Set((caseData.investigation?.nextActions ?? []).map((a) => a.channel).filter(Boolean) as string[])];

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!kind) return;
    const fd = new FormData(ev.currentTarget);
    const get = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    const body: Record<string, unknown> = { type: kind };
    if (kind === "complaint_submitted") Object.assign(body, { channel: get("channel"), referenceNumber: get("referenceNumber"), date: get("date"), packet: get("packet") ?? "complaint", notes: get("notes") });
    if (kind === "response_received") Object.assign(body, { date: get("date"), referenceNumber: get("referenceNumber"), notes: get("notes") });
    if (kind === "follow_up_scheduled") Object.assign(body, { followUpDate: get("followUpDate"), notes: get("notes") });
    if (kind === "note") Object.assign(body, { notes: get("notes") });
    if (kind === "status_changed") Object.assign(body, { toStatus: get("toStatus"), notes: get("notes") });
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cases/${caseData.id}/timeline`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-owner-key": ownerKey ?? "" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.fields ? Object.values(d.fields).join(" ") : d.error);
        return;
      }
      onUpdated(d.case);
      setKind(null);
    } catch {
      setError("Network error; nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!ownerKey) {
    return (
      <div className="rounded-2xl border border-rule bg-paper-2/60 p-5">
        <p className="text-[14.5px] font-medium text-ink">Only the person who filed this report can record submissions and responses.</p>
        <p className="mt-1 text-[13.5px] text-ink-3">If that&apos;s you, paste the owner key you received when you reported. It stays in this browser.</p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setKeyError(null);
            const ok = await onOwnerKey(keyInput.trim());
            if (!ok) setKeyError("That key doesn't match this case.");
          }}
        >
          <input className={cn(field, "font-mono")} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Owner key" aria-label="Owner key" />
          <Button type="submit" variant="secondary" disabled={keyInput.trim().length < 10}>Unlock</Button>
        </form>
        {keyError && <p className="mt-2 text-[13px] text-contradicted" role="alert">{keyError}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
      <p className="text-[13px] text-ink-3">You filed this report. Record what happens outside CivicProof; nothing is sent anywhere automatically.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {FORMS.map((f) => (
          <button
            key={f.kind}
            type="button"
            onClick={() => { setKind(kind === f.kind ? null : f.kind); setError(null); }}
            className={cn("h-9 rounded-full border px-3.5 text-[13.5px] transition-colors", kind === f.kind ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2 hover:border-ink/40")}
            aria-pressed={kind === f.kind}
          >
            {f.label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {kind && (
          <motion.form
            key={kind}
            onSubmit={submit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 pt-4 sm:grid-cols-2">
              {kind === "complaint_submitted" && (
                <>
                  <label className="text-[13px] text-ink-2">What did you send?
                    <select name="packet" className={cn(field, "mt-1")} defaultValue="complaint">
                      <option value="complaint">Complaint</option>
                      <option value="rti">RTI application</option>
                    </select>
                  </label>
                  <label className="text-[13px] text-ink-2">Where?
                    <input name="channel" list="channels" required className={cn(field, "mt-1")} placeholder="e.g. CPGRAMS, RTI Online, by post" />
                    <datalist id="channels">{channels.map((c) => <option key={c} value={c} />)}</datalist>
                  </label>
                  <label className="text-[13px] text-ink-2">Reference number (as issued)
                    <input name="referenceNumber" className={cn(field, "mt-1 font-mono")} placeholder="Leave blank if none was issued" />
                  </label>
                  <label className="text-[13px] text-ink-2">Date submitted
                    <input name="date" type="date" max={TODAY()} defaultValue={TODAY()} required className={cn(field, "mt-1")} />
                  </label>
                </>
              )}
              {kind === "response_received" && (
                <>
                  <label className="text-[13px] text-ink-2">Date of response
                    <input name="date" type="date" max={TODAY()} defaultValue={TODAY()} required className={cn(field, "mt-1")} />
                  </label>
                  <label className="text-[13px] text-ink-2">Reference in the response
                    <input name="referenceNumber" className={cn(field, "mt-1 font-mono")} />
                  </label>
                </>
              )}
              {kind === "follow_up_scheduled" && (
                <label className="text-[13px] text-ink-2">Follow up on
                  <input name="followUpDate" type="date" min={TODAY()} required className={cn(field, "mt-1")} />
                </label>
              )}
              {kind === "status_changed" && (
                <label className="text-[13px] text-ink-2">New status
                  <select name="toStatus" className={cn(field, "mt-1")} defaultValue={caseData.status}>
                    {(Object.keys(STATUS_LABELS) as CaseStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </label>
              )}
              <label className="text-[13px] text-ink-2 sm:col-span-2">{kind === "response_received" ? "What did they say?" : "Notes"}
                <textarea name="notes" rows={3} required={kind === "note" || kind === "response_received"} className={cn(field, "mt-1 resize-y")} />
              </label>
            </div>
            {kind === "complaint_submitted" && (
              <p className="mt-2 text-[12.5px] text-ink-3">For an RTI application the reply is due within 30 days of receipt (Section 7(1)); CivicProof will show the date. For complaints it suggests a 14-day follow-up.</p>
            )}
            {error && <p className="mt-2 text-[13px] text-contradicted" role="alert">{error}</p>}
            <div className="mt-3 flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save to timeline"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setKind(null)}>Cancel</Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
