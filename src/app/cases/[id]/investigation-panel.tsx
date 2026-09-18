"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PublicCase, TraceStep } from "@/lib/schemas";
import { STAGES, type StageId } from "@/lib/agent/stages";
import { Button, formatDateTime } from "@/components/ui";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { BorderTrail } from "@/components/motion-primitives/border-trail";
import { cn } from "@/lib/utils";

export interface LiveState {
  running: boolean;
  stage?: StageId;
  trace: TraceStep[];
  engine?: "bedrock" | "gemini" | "rules";
  model?: string;
  error?: string;
}

const KIND_ICON: Record<TraceStep["kind"], { glyph: string; cls: string; label: string }> = {
  stage: { glyph: "›", cls: "text-ink-3", label: "Stage" },
  tool_call: { glyph: "→", cls: "text-ink-3", label: "Tool call" },
  tool_result: { glyph: "←", cls: "text-ink-3", label: "Result" },
  decision: { glyph: "◆", cls: "text-accent", label: "Decision" },
  denied: { glyph: "⊘", cls: "text-contradicted", label: "Blocked by policy" },
  rejected: { glyph: "✕", cls: "text-partial", label: "Rejected by verifier" },
  note: { glyph: "·", cls: "text-ink-3", label: "Note" },
  error: { glyph: "!", cls: "text-contradicted", label: "Error" },
};

export function engineLabel(engine?: string, model?: string) {
  if (engine === "gemini") return `Google Gemini${model ? ` · ${model}` : ""}`;
  if (engine === "bedrock") return `Amazon Bedrock${model ? ` · ${model.replace(/^(global|us|apac|eu)\./, "")}` : ""}`;
  if (engine === "rules") return "Rules planner · no language model";
  return "";
}

function StageList({ current, done, running }: { current?: StageId; done: boolean; running: boolean }) {
  const idx = current ? STAGES.findIndex((s) => s.id === current) : -1;
  return (
    <ol className="space-y-0.5">
      {STAGES.map((s, i) => {
        const state = done || i < idx ? "done" : i === idx && running ? "active" : i === idx ? "done" : "pending";
        return (
          <li key={s.id} className="flex items-center gap-3 py-1.5">
            <span
              className={cn(
                "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors duration-300",
                state === "done" && "border-ink bg-ink text-paper",
                state === "active" && "border-accent text-accent",
                state === "pending" && "border-rule-strong text-ink-3",
              )}
              aria-hidden
            >
              {state === "done" ? (
                <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2.5 6.3 5 8.7l4.5-5.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : state === "active" ? (
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
              ) : (
                <span className="font-mono">{i + 1}</span>
              )}
            </span>
            {state === "active" ? (
              <TextShimmer className="text-[14px] font-medium [--base-color:#2542c8] [--base-gradient-color:#b9c3f2]" duration={1.6}>
                {s.label}
              </TextShimmer>
            ) : (
              <span className={cn("text-[14px]", state === "pending" ? "text-ink-3" : "text-ink")}>{s.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TraceFeed({ trace, live, max }: { trace: TraceStep[]; live?: boolean; max?: number }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [trace.length, live]);
  const items = max ? trace.slice(-max) : trace;
  return (
    <ol ref={ref} tabIndex={0} aria-label="Agent trace" className={cn("space-y-1 overflow-y-auto font-mono text-[12.5px] leading-relaxed", live ? "max-h-[300px]" : "max-h-[420px]")} aria-live={live ? "polite" : undefined}>
      <AnimatePresence initial={false}>
        {items.map((t, i) => {
          const k = KIND_ICON[t.kind];
          return (
            <motion.li
              key={`${t.at}-${i}-${t.summary.slice(0, 20)}`}
              initial={live ? { opacity: 0, x: -6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-[16px_1fr] gap-2"
            >
              <span className={cn("select-none text-center", k.cls)} title={k.label} aria-label={k.label}>{k.glyph}</span>
              <span className={cn("min-w-0 break-words", t.kind === "denied" ? "text-contradicted" : t.kind === "rejected" ? "text-partial" : "text-ink-2")}>
                {t.tool && <span className="text-ink-3">{t.tool} </span>}
                {t.summary}
                {t.kind === "rejected" && Array.isArray((t.detail as { rejections?: string[] })?.rejections) && (
                  <span className="block text-[11.5px] text-ink-3">{(t.detail as { rejections: string[] }).rejections[0]}</span>
                )}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

export function InvestigationPanel({
  caseData,
  live,
  onRun,
  canRun,
}: {
  caseData: PublicCase;
  live: LiveState;
  onRun: () => void;
  canRun: boolean;
}) {
  const inv = caseData.investigation;
  const [showTrace, setShowTrace] = useState(false);
  const running = live.running || inv?.status === "running";
  const trace = live.running ? live.trace : inv?.trace ?? [];
  const engine = live.engine ?? inv?.engine;
  const model = live.model ?? inv?.model;

  const stats = useMemo(() => {
    if (!inv || inv.status !== "complete") return null;
    const verified = inv.claims.filter((c) => c.verification === "verified" && c.origin !== "computed").length;
    const docs = new Set(inv.evidence.filter((e) => e.verification === "verified").map((e) => e.docId)).size;
    const tools = inv.trace.filter((t) => t.tool).length;
    const denied = inv.trace.filter((t) => t.kind === "denied" || t.kind === "rejected").length;
    const secs = inv.finishedAt ? Math.max(1, Math.round((Date.parse(inv.finishedAt) - Date.parse(inv.startedAt)) / 1000)) : undefined;
    return { verified, docs, tools, denied, secs, open: inv.missing.length };
  }, [inv]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
      {running && <BorderTrail className="bg-gradient-to-l from-accent/0 via-accent to-accent/0" size={120} transition={{ repeat: Infinity, duration: 5, ease: "linear" }} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <p className="text-[15px] font-medium leading-tight">{running ? "Agent running" : inv ? "Agent run" : "Not yet investigated"}</p>
          {engine && <p className="mt-0.5 font-mono text-[12px] text-ink-3">{engineLabel(engine, model)} · Strands Agents · Cedar</p>}
        </div>
        {!running && canRun && (
          <Button variant={inv ? "secondary" : "accent"} size="sm" onClick={onRun}>
            {inv ? "Run again" : "Start investigation"}
          </Button>
        )}
      </div>

      {!inv && !running && (
        <div className="px-5 py-6">
          <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">
            The investigator reads this report, finds public works projects at this location, reads the official documents, and records
            each fact with a quotation. A verifier checks every quotation against the document before it counts.
          </p>
        </div>
      )}

      {running && (
        <div className="grid gap-6 px-5 py-5 md:grid-cols-[230px_1fr]">
          <StageList current={live.stage} done={false} running />
          <div className="min-w-0 rounded-xl bg-paper/70 p-3.5">
            {trace.length ? <TraceFeed trace={trace} live /> : <p className="font-mono text-[12.5px] text-ink-3">Starting…</p>}
          </div>
        </div>
      )}

      {!running && inv?.status === "failed" && (
        <div className="px-5 py-5">
          <p className="text-[14px] text-contradicted">The investigation stopped with an error: {inv.error ?? live.error ?? "unknown error"}.</p>
          <p className="mt-1 text-[13px] text-ink-3">Anything found before the error is kept below. You can run it again.</p>
        </div>
      )}

      {!running && inv?.status === "complete" && stats && (
        <div className="px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {[
              { k: "Verified facts", v: stats.verified },
              { k: "Official documents cited", v: stats.docs },
              { k: "Open questions", v: stats.open },
              { k: "Agent steps", v: stats.tools },
            ].map((s) => (
              <div key={s.k}>
                <dt className="text-[12px] text-ink-3">{s.k}</dt>
                <dd className="tnum mt-0.5 font-serif text-[30px] leading-none">{s.v}</dd>
              </div>
            ))}
          </dl>
          {inv.summary && (
            <div className="mt-5 border-t border-rule pt-4">
              <p className="text-[12px] font-medium text-ink-3">{engine && engine !== "rules" && !model?.endsWith("rules planner") ? "Summary written by the model" : "Summary (generated from verified facts)"}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{inv.summary}</p>
            </div>
          )}
          {inv.analysis && (
            <div className="mt-4 rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 p-4">
              <p className="text-[12px] font-medium text-accent">AI analysis · verify before relying on it</p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{inv.analysis}</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-3">
            <span>Finished {inv.finishedAt ? formatDateTime(inv.finishedAt) : ""}{stats.secs ? ` · ${stats.secs}s` : ""}</span>
            {stats.denied > 0 && <span className="text-partial">{stats.denied} step{stats.denied === 1 ? "" : "s"} blocked or rejected</span>}
            {inv.usage && <span className="font-mono">{inv.usage.inputTokens.toLocaleString("en-IN")} in / {inv.usage.outputTokens.toLocaleString("en-IN")} out tokens</span>}
            <button type="button" className="font-medium text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink" onClick={() => setShowTrace((s) => !s)} aria-expanded={showTrace}>
              {showTrace ? "Hide" : "Show"} full agent trace ({inv.trace.length})
            </button>
          </div>
          <AnimatePresence initial={false}>
            {showTrace && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-4 rounded-xl bg-paper/70 p-3.5">
                  <TraceFeed trace={inv.trace} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
