"use client";

import Link from "next/link";
import type { NextAction, PublicCase } from "@/lib/schemas";
import { buttonClass, ExternalIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<NextAction["type"], string> = {
  defect_liability_repair_request: "Repair request",
  grievance_portal: "Complaint",
  rti_request: "RTI application",
  follow_up: "Follow-up",
  add_evidence: "More evidence",
};

export function NextActions({ caseData }: { caseData: PublicCase }) {
  const actions = caseData.investigation?.nextActions ?? [];
  const id = caseData.id;

  return (
    <div className="space-y-3">
      {actions.length === 0 && (
        <p className="text-[14px] text-ink-3">Next steps appear after the investigation, based only on what was verified.</p>
      )}
      {actions.map((a, i) => (
        <article
          key={`${a.type}-${i}`}
          className={cn("rounded-2xl border bg-card p-5 shadow-card", i === 0 ? "border-ink/25" : "border-rule", a.origin === "ai" && "border-dashed border-accent/40")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <span className="rounded-full bg-paper-3 px-2.5 py-0.5 text-[12px] text-ink-2">{TYPE_LABEL[a.type]}</span>
            {a.origin === "ai" ? (
              <span className="rounded-full border border-dashed border-accent/50 px-2.5 py-0.5 text-[12px] text-accent">AI suggestion</span>
            ) : (
              <span className="text-[12px] text-ink-3">Derived from verified facts</span>
            )}
          </div>
          <h3 className="mt-2.5 font-serif text-[21px] leading-snug">{a.title}</h3>
          <p className="mt-1.5 max-w-3xl text-[14.5px] leading-relaxed text-ink-2">{a.rationale}</p>
          {(a.addressedTo || a.channel) && (
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
              {a.addressedTo && (
                <>
                  <dt className="text-ink-3">Address to</dt>
                  <dd className="text-ink">{a.addressedTo}</dd>
                </>
              )}
              {a.channel && (
                <>
                  <dt className="text-ink-3">Channel</dt>
                  <dd className="text-ink">
                    {a.channelUrl ? (
                      <a href={a.channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                        {a.channel} <ExternalIcon />
                      </a>
                    ) : (
                      a.channel
                    )}
                  </dd>
                </>
              )}
            </dl>
          )}
          {a.channelNote && <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-3">{a.channelNote}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {a.type === "rti_request" ? (
              <Link href={`/cases/${id}/packet?kind=rti`} className={buttonClass(i === 0 ? "primary" : "secondary", "sm")}>Draft the RTI application</Link>
            ) : a.type === "defect_liability_repair_request" || a.type === "grievance_portal" ? (
              <Link href={`/cases/${id}/packet?kind=complaint`} className={buttonClass(i === 0 ? "primary" : "secondary", "sm")}>Draft the complaint</Link>
            ) : null}
            <a href="#tracking" className={buttonClass("ghost", "sm")}>Record what you did</a>
          </div>
        </article>
      ))}
    </div>
  );
}
