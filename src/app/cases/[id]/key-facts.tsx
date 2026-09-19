"use client";

import { motion, useReducedMotion } from "motion/react";
import { matchPlacement, type PublicCase, type Verification } from "@/lib/schemas";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import { cn } from "@/lib/utils";

interface Tile {
  label: string;
  value: string;
  note: string;
  tone: "verified" | "partial" | "missing" | "accent" | "neutral";
}

const TONE: Record<Tile["tone"], string> = {
  verified: "before:bg-verified",
  partial: "before:bg-partial",
  missing: "before:bg-rule-strong",
  accent: "before:bg-accent",
  neutral: "before:bg-ink",
};

function toneFor(v?: Verification): Tile["tone"] {
  return v === "verified" ? "verified" : v === "partially_verified" ? "partial" : "missing";
}

function fmt(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The four facts that decide what to do next, readable in a glance. */
export function KeyFacts({ caseData }: { caseData: PublicCase }) {
  const reduce = useReducedMotion();
  const inv = caseData.investigation;
  if (!inv || inv.status !== "complete") return null;
  const match = inv.matches.find((m) => m.projectId === inv.selectedProjectId);
  // What the work was meant to be. The contractor is not repeated here: it sits in the
  // determination card immediately below, where it carries its verification state and the note
  // that a contracted party is not a responsible party.
  const scope = inv.claims.find((c) => (c.field === "scope" || c.field === "roads_covered") && c.origin === "official_record");
  // Only a code the registry accepted is shown beside the project. A rejected one would read here
  // as the identifier this project was matched by, which is not what happened.
  const identity = inv.determination?.identity;
  const code = identity?.patternValid === false ? undefined : identity?.normalizedCode;
  // Only a window computed by code may be shown as computed; anything else is not a window at all.
  const window = inv.claims.find((c) => c.field === "maintenance_window" && c.origin === "computed");
  const dlp = inv.claims.find((c) => c.field === "defect_liability");
  const ambiguous = inv.matches.length > 1 && Math.abs(inv.matches[0].score - inv.matches[1].score) < 0.05;

  const tiles: Tile[] = [
    match
      ? { label: "Project", value: match.projectName.length > 48 ? match.projectName.slice(0, 46) + "…" : match.projectName, note: `${code ? code + " · " : ""}${upperFirst(matchPlacement(match))}${ambiguous ? " · another project equally close" : ""}`, tone: ambiguous ? "partial" : "accent" }
      : { label: "Project", value: "Not identified", note: "No project in the corpus at this spot", tone: "missing" },
    scope
      ? { label: "What the work covers", value: scope.value ?? scope.text, note: scope.verification === "verified" ? "Verified in the official record" : "Not confirmed verbatim", tone: toneFor(scope.verification) }
      : { label: "What the work covers", value: "Not established", note: "Ask for the detailed estimate via RTI", tone: "missing" },
    window
      ? window.value?.startsWith("inside:")
        ? { label: "Maintenance window", value: `Open until ${fmt(window.value.slice(7))}`, note: "Computed from cited dates", tone: "verified" }
        : window.value?.startsWith("outside:")
          ? { label: "Maintenance window", value: `Ended ${fmt(window.value.slice(8))}`, note: "Computed from cited dates", tone: "neutral" }
          : { label: "Maintenance window", value: "Before completion", note: "Observed before the recorded completion", tone: "partial" }
      : { label: "Maintenance window", value: dlp ? "Can't be computed" : "Not established", note: dlp ? "Completion date not in the records" : "No defect-liability clause found", tone: "missing" },
    { label: "Open questions", value: String(inv.missing.length), note: inv.missing.length ? "Each becomes an RTI request" : "Nothing missing for a complaint", tone: inv.missing.length ? "partial" : "verified" },
  ];

  return (
    <ul className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <motion.li
          key={t.label}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 * i, ease: [0.2, 0.7, 0.2, 1] }}
          className={cn("relative bg-card px-5 py-4 before:absolute before:left-0 before:top-4 before:h-8 before:w-[3px] before:rounded-r", TONE[t.tone])}
        >
          <p className="text-[12px] text-ink-3">{t.label}</p>
          <p className="mt-1 line-clamp-2 font-serif text-[19px] leading-snug text-ink">{t.value}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">{t.note}</p>
        </motion.li>
      ))}
    </ul>
  );
}
