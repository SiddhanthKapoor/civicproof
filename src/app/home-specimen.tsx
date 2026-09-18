"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Highlighted } from "@/components/evidence";
import { OriginTag, VerificationBadge } from "@/components/ui";
import type { Origin, Verification } from "@/lib/schemas";

export interface SpecimenRow {
  label: string;
  value: string;
  verification: Verification;
  origin: Origin;
  excerpt?: string;
  source?: string;
  page?: number;
}

/** The hero's "case file": real claims from a demo case, revealed row by row. */
export function HomeSpecimen({ caseId, title, project, rows }: { caseId: string; title: string; project: string; rows: SpecimenRow[] }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24, rotate: 0.6 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.9, delay: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
      className="relative"
    >
      <div aria-hidden className="absolute -right-3 -top-3 h-full w-full rounded-[22px] border border-rule bg-paper-2" />
      <div className="relative overflow-hidden rounded-[22px] border border-rule bg-card shadow-lift">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <span className="font-mono text-[12px] text-ink-3">{caseId}</span>
          <span className="text-[12px] text-ink-3">Demo report · real records</span>
        </div>
        <div className="px-5 pb-2 pt-4">
          <p className="font-serif text-[21px] leading-snug">{title}</p>
          <p className="mt-1 line-clamp-1 text-[13px] text-ink-3">Linked to {project}</p>
        </div>
        <ul className="px-5 pb-4">
          {rows.map((r, i) => (
            <motion.li
              key={r.label}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 + i * 0.22, ease: [0.2, 0.7, 0.2, 1] }}
              className="border-t border-rule py-3 first:border-t-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-ink-3">{r.label}</p>
                  <p className="mt-0.5 font-serif text-[17px] leading-snug">{r.value}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <VerificationBadge v={r.verification} />
                  <OriginTag o={r.origin} className="hidden sm:inline-flex" />
                </div>
              </div>
              {r.excerpt && (
                <div className="mt-2 border-l-2 border-marker-strong pl-3">
                  <p className="line-clamp-2 font-serif text-[13.5px] leading-[1.5] text-ink-2">
                    <span className="mark">
                      <Highlighted text={r.excerpt} value={r.value.replace(/^₹/, "")} radius={48} />
                    </span>
                  </p>
                  {r.source && <p className="mt-0.5 text-[11.5px] text-ink-3">{r.source}{r.page ? `, p. ${r.page}` : ""}</p>}
                </div>
              )}
            </motion.li>
          ))}
        </ul>
        <Link href={`/cases/${caseId}`} className="block border-t border-rule bg-paper/60 px-5 py-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink">
          Open this case →
        </Link>
      </div>
    </motion.div>
  );
}
