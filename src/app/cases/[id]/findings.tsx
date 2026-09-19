"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Claim, ClaimField, Conflict, Evidence, MissingItem } from "@/lib/schemas";
import { CLAIM_FIELD_LABELS } from "@/lib/schemas";
import { buildCiteIndex, ClaimRow } from "@/components/evidence";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ title: string; blurb: string; fields: ClaimField[] }> = [
  { title: "Who is responsible", blurb: "The project, the agency that executes it, and the contractor named in the records.", fields: ["project_name", "project_id", "agency", "contractor"] },
  { title: "Money", blurb: "Amounts as stated in the records, with their units.", fields: ["contract_value", "sanctioned_cost", "estimated_cost", "maintenance_cost"] },
  { title: "Dates and obligations", blurb: "When the work was awarded and completed, and how long the contractor must maintain it.", fields: ["award_date", "work_order_date", "start_date", "completion_date", "completion_period", "defect_liability", "maintenance_window"] },
  { title: "Scope and condition", blurb: "What the work was meant to include, and what inspections and audits recorded.", fields: ["roads_covered", "scope", "work_status", "quality_grade", "audit_finding", "other"] },
  { title: "From the report", blurb: "Observations about the citizen's report. These are not official records.", fields: ["photo_observation", "reported_condition", "location_match"] },
];

export function Findings({
  claims,
  evidence,
  missing,
  conflicts,
  live,
}: {
  claims: Claim[];
  evidence: Evidence[];
  missing: MissingItem[];
  conflicts: Conflict[];
  live?: boolean;
}) {
  // Same numbering as the complaint packet's "Supporting evidence" list.
  const citeIndex = useMemo(() => buildCiteIndex(evidence), [evidence]);

  const counts = useMemo(() => {
    const official = claims.filter((c) => c.origin === "official_record");
    return {
      verified: official.filter((c) => c.verification === "verified").length,
      partial: claims.filter((c) => c.verification === "partially_verified").length,
      unverified: claims.filter((c) => c.verification === "unverified").length,
      contradicted: claims.filter((c) => c.verification === "contradicted").length,
    };
  }, [claims]);

  if (!claims.length && !missing.length) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
        <span><b className="tnum font-semibold text-verified">{counts.verified}</b> verified in official records</span>
        {counts.partial > 0 && <span><b className="tnum font-semibold text-partial">{counts.partial}</b> partially verified</span>}
        {counts.unverified > 0 && <span><b className="tnum font-semibold text-ink">{counts.unverified}</b> not verified</span>}
        {counts.contradicted > 0 && <span><b className="tnum font-semibold text-contradicted">{counts.contradicted}</b> in conflict</span>}
        <span><b className="tnum font-semibold text-ink">{missing.length}</b> open question{missing.length === 1 ? "" : "s"}</span>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-contradicted/30 bg-contradicted-soft/60 p-4">
          <p className="text-[13px] font-semibold text-contradicted">Sources disagree</p>
          <ul className="mt-2 space-y-1.5 text-[14px] text-ink-2">
            {conflicts.map((c, i) => (
              <li key={i}><span className="font-medium text-ink">{CLAIM_FIELD_LABELS[c.field]}:</span> {c.description}</li>
            ))}
          </ul>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = claims.filter((c) => g.fields.includes(c.field)).sort((a, b) => g.fields.indexOf(a.field) - g.fields.indexOf(b.field));
        if (!items.length) return null;
        return (
          <section key={g.title} className="rounded-2xl border border-rule bg-card shadow-card">
            <header className="border-b border-rule px-5 py-3.5">
              <h3 className="font-serif text-[19px] leading-tight">{g.title}</h3>
              <p className="mt-0.5 text-[13px] text-ink-3">{g.blurb}</p>
            </header>
            <div className="px-5">
              <AnimatePresence initial={false}>
                {items.map((c) => (
                  <motion.div key={c.id} initial={live ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                    <ClaimRow claim={c} evidence={evidence} citeIndex={citeIndex} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        );
      })}

      {missing.length > 0 && (
        <section className="rounded-2xl border border-dashed border-rule-strong bg-paper-2/60">
          <header className="border-b border-dashed border-rule-strong px-5 py-3.5">
            <h3 className="font-serif text-[19px] leading-tight">Not established by the records</h3>
            <p className="mt-0.5 text-[13px] text-ink-3">Each of these can be requested. The RTI draft asks for these records first.</p>
          </header>
          <ul className="divide-y divide-dashed divide-rule-strong px-5">
            {missing.map((m) => (
              <li key={m.field} className="grid gap-1 py-3.5 sm:grid-cols-[170px_1fr]">
                <span className="text-[13px] font-medium text-ink-3">{m.label}</span>
                <div>
                  <p className="text-[14.5px] text-ink-2">{m.reason}</p>
                  {/* Why the gap matters is written by code, never by a model: it states what this
                      missing record blocks, so a reader can judge the gap rather than take it on trust. */}
                  {m.whyItMatters && (
                    <p className="mt-1 text-[13px] text-ink-3">
                      Why it matters: <span className="text-ink-2">{m.whyItMatters}</span>
                    </p>
                  )}
                  {m.requestableRecord && (
                    <p className={cn("mt-1 text-[13px] text-ink-3")}>
                      Record to request: <span className="text-ink-2">{m.requestableRecord}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
