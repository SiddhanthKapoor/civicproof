"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CLAIM_FIELD_LABELS, type Claim, type Evidence } from "@/lib/schemas";
import { ExternalIcon, OriginTag, VerificationBadge } from "./ui";
import { cn } from "@/lib/utils";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Candidate substrings of a claim value to highlight inside an excerpt, most specific first. */
function highlightCandidates(value: string): RegExp[] {
  const out: RegExp[] = [];
  const tokens = value.trim().split(/\s+/).map(escapeRegex);
  if (tokens.length) out.push(new RegExp(tokens.join("\\s*"), "i"));
  const num = value.match(/\d[\d,]*(?:\.\d+)?/);
  if (num) out.push(new RegExp(`(?<![\\d.])${escapeRegex(num[0])}(?![\\d])`));
  const dur = value.match(/^(\d+)\s*(year|month)/i);
  if (dur) out.push(new RegExp(`${dur[1]}\\s*-?\\s*${dur[2]}s?`, "i"));
  return out;
}

/**
 * Wraps the first match of `value` in a strong highlighter mark. With `radius`, long excerpts
 * are windowed around the match ("…text around the value…"); the full excerpt stays in Details.
 */
export function Highlighted({ text, value, radius }: { text: string; value?: string; radius?: number }) {
  if (!value) return <>{radius && text.length > radius * 2 ? text.slice(0, radius * 2) + "…" : text}</>;
  for (const re of highlightCandidates(value)) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      let before = text.slice(0, m.index);
      let after = text.slice(m.index + m[0].length);
      if (radius) {
        if (before.length > radius) before = "…" + before.slice(before.length - radius).replace(/^\S*\s/, "");
        if (after.length > radius) after = after.slice(0, radius).replace(/\s\S*$/, "") + "…";
      }
      return (
        <>
          {before}
          <span className="mark-strong rounded-[2px] px-0.5">{m[0]}</span>
          {after}
        </>
      );
    }
  }
  return <>{text}</>;
}

export function sourceHref(e: Pick<Evidence, "docId" | "page" | "excerpt">) {
  const q = e.excerpt.replace(/\s+/g, " ").slice(0, 160);
  return `/sources/${encodeURIComponent(e.docId)}?page=${e.page ?? 1}&q=${encodeURIComponent(q)}#p${e.page ?? 1}`;
}

/** Shared numbering: the same excerpt from the same page gets the same [n] everywhere. */
export function evidenceKey(e: Pick<Evidence, "docId" | "page" | "excerpt">) {
  return `${e.docId}|${e.page ?? 0}|${e.excerpt.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

export function buildCiteIndex(evidence: Evidence[]) {
  const byKey = new Map<string, number>();
  const byId = new Map<string, number>();
  for (const e of evidence) {
    if (e.verification !== "verified" && e.verification !== "partially_verified") continue;
    const k = evidenceKey(e);
    if (!byKey.has(k)) byKey.set(k, byKey.size + 1);
    byId.set(e.id, byKey.get(k)!);
  }
  return byId;
}

export function EvidenceQuote({ e, value, index }: { e: Evidence; value?: string; index?: number }) {
  return (
    <figure className="rounded-xl border border-rule bg-paper/60 p-3.5">
      <blockquote className="font-serif text-[15px] leading-[1.55] text-ink">
        <span className="mark">
          <Highlighted text={e.excerpt.replace(/\s+/g, " ")} value={value} />
        </span>
      </blockquote>
      <figcaption className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
        {index !== undefined && <span className="font-mono text-ink-2">[{index}]</span>}
        <Link href={sourceHref(e)} className="font-medium text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-accent hover:decoration-accent">
          {e.sourceTitle}
        </Link>
        {e.page && <span className="font-mono">p. {e.page}</span>}
        {e.publisher && <span>{e.publisher}</span>}
        {e.sourceUrl && (
          <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
            Original <ExternalIcon />
          </a>
        )}
      </figcaption>
      {e.checkNote && <p className={cn("mt-2 text-[12px]", e.verification === "verified" ? "text-verified" : "text-partial")}>{e.checkNote}</p>}
    </figure>
  );
}

/** One line of evidence under a claim: the quoted words, and where they are. */
function InlineQuote({ e, value, index }: { e: Evidence; value?: string; index?: number }) {
  return (
    <div className="mt-2.5 border-l-2 border-marker-strong pl-3">
      <p className="line-clamp-3 font-serif text-[14.5px] leading-[1.5] text-ink">
        <span className="mark">
          <Highlighted text={e.excerpt.replace(/\s+/g, " ")} value={value} radius={110} />
        </span>
      </p>
      <p className="mt-1 text-[12px] text-ink-3">
        {index !== undefined && <span className="mr-1.5 font-mono text-ink-2">[{index}]</span>}
        <Link href={sourceHref(e)} className="text-ink-2 underline decoration-rule-strong underline-offset-[3px] hover:text-accent hover:decoration-accent">
          {e.sourceTitle}
        </Link>
        {e.page && <span className="font-mono">, p. {e.page}</span>}
      </p>
    </div>
  );
}

export function ClaimRow({ claim, evidence, citeIndex }: { claim: Claim; evidence: Evidence[]; citeIndex?: Map<string, number> }) {
  const [open, setOpen] = useState(false);
  const ev = evidence.filter((e) => claim.evidenceIds.includes(e.id));
  // Lead with the excerpt that carries the value, not a units note.
  const lead = ev.find((e) => claim.value && highlightCandidates(claim.value).some((re) => re.test(e.excerpt.replace(/\s+/g, " ")))) ?? ev[0];
  const isValueShort = claim.value && claim.value.length < 90 && !/^(inside|outside):/.test(claim.value) && claim.value !== "before_completion";
  return (
    <div className="border-b border-rule py-4 last:border-b-0">
      <div className="grid gap-2 sm:grid-cols-[170px_1fr] sm:gap-3">
        <p className="pt-0.5 text-[13px] font-medium text-ink-3">{CLAIM_FIELD_LABELS[claim.field]}</p>
        <div className="min-w-0">
          {isValueShort && (
            <p className={cn("font-serif text-[20px] leading-snug break-words", claim.verification === "unverified" && "text-ink-2")}>{claim.value}</p>
          )}
          <p className={cn("text-[14.5px] leading-relaxed", isValueShort ? "text-ink-2" : "text-[15px] text-ink")}>{claim.text}</p>
          {lead && <InlineQuote e={lead} value={claim.value} index={citeIndex?.get(lead.id)} />}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <VerificationBadge v={claim.verification} />
            <OriginTag o={claim.origin} />
            {(ev.length > 0 || claim.notes) && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] text-ink-3 hover:bg-paper-3 hover:text-ink"
                aria-expanded={open}
              >
                {open ? "Hide details" : ev.length > 1 ? `Details · ${ev.length} sources` : "Details"}
                <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden>
                  <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2.5">
                  {claim.notes && <p className="text-[12.5px] leading-relaxed text-ink-3">{claim.notes}</p>}
                  {ev.map((e) => (
                    <EvidenceQuote key={e.id} e={e} value={claim.value} index={citeIndex?.get(e.id)} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
