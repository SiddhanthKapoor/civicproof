"use client";

import Link from "next/link";
import type { NextAction, PublicCase } from "@/lib/schemas";
import { nextSteps } from "@/lib/submission";
import { buttonClass, ExternalIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<NextAction["type"], string> = {
  defect_liability_repair_request: "Repair request",
  grievance_portal: "Complaint",
  rti_request: "RTI application",
  follow_up: "Follow-up",
  add_evidence: "More evidence",
};

/**
 * The practical procedure, then the routing.
 *
 * The six steps are the same on every case and are written in code (`nextSteps`), so what a citizen
 * is told to do never varies with model output. A step shows as recorded only when the case's own
 * timeline says so — CivicProof never reports a submission it has not been told about, because it
 * never makes one. Beneath them sit the routed actions, which are derived from the verified facts
 * and carry the office and channel the packet should go to.
 */
const LINK = "text-[13px] text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-accent";

function Steps({ caseData }: { caseData: PublicCase }) {
  // The complaint channel, taken from the routed actions (which read it from the authority
  // directory). An RTI action carries the RTI portal, which is not where a complaint goes.
  const routed = (caseData.investigation?.nextActions ?? []).find(
    (a) => a.type === "defect_liability_repair_request" || a.type === "grievance_portal",
  );
  const steps = nextSteps({
    caseId: caseData.id,
    timeline: caseData.timeline,
    destination: routed?.channelUrl ? { verified: true, channel: routed.channel, url: routed.channelUrl } : undefined,
    status: caseData.status,
  });

  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.n} className="flex gap-3.5 rounded-2xl border border-rule bg-card p-4 shadow-card sm:p-5">
          <span
            className={cn(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[12px]",
              s.recorded ? "bg-verified-soft text-verified" : "bg-paper-3 text-ink-2",
            )}
            aria-hidden
          >
            {s.n}
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15.5px] font-medium leading-snug text-ink">{s.title}</h3>
              {s.recorded && (
                <span className="rounded-full bg-verified-soft px-2 py-0.5 text-[12px] text-verified">Done · {s.recorded}</span>
              )}
            </div>
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{s.detail}</p>
            {s.note && <p className="max-w-2xl rounded-lg bg-missing-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{s.note}</p>}
            {(s.channel || s.href) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                {s.channel && (
                  <a
                    href={s.channel.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] text-ink underline decoration-rule-strong underline-offset-4 hover:text-accent"
                  >
                    Open {s.channel.label} <ExternalIcon />
                  </a>
                )}
                {/* A hash is a jump within this page, not a route: Link would prefetch nothing. */}
                {s.href?.startsWith("#") ? (
                  <a href={s.href} className={LINK}>{s.linkLabel}</a>
                ) : s.href ? (
                  <Link href={s.href} className={LINK}>{s.linkLabel}</Link>
                ) : null}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function NextActions({ caseData }: { caseData: PublicCase }) {
  const actions = caseData.investigation?.nextActions ?? [];
  const id = caseData.id;

  return (
    <div className="space-y-3">
      <Steps caseData={caseData} />
      {actions.length === 0 && (
        <p className="text-[14px] text-ink-3">Next steps appear after the investigation, based only on what was verified.</p>
      )}
      {actions.length > 0 && (
        <p className="pt-3 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Where this goes, and why</p>
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
              <span className="text-[12px] text-ink-3">{a.type === "rti_request" || a.type === "add_evidence" ? "Derived from the open questions" : "Derived from verified facts"}</span>
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
          {/* Where the destination came from. Every fact on this case is quoted from a cited page;
              the office and channel are not — they are read from CivicProof's authority directory.
              Saying so is the difference between "the records establish this" and "this is where we
              believe it should go", and the citizen is the one who has to send it. */}
          {a.origin === "rule" && (a.addressedTo || a.channel) && (
            <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-3">
              Destination from CivicProof&rsquo;s directory of authorities, not from this project&rsquo;s documents
              {a.channelSourceUrl ? (
                <>
                  {" ("}
                  <a href={a.channelSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-4 hover:text-accent">
                    source <ExternalIcon />
                  </a>
                  {")"}
                </>
              ) : null}. Confirm the office before you send it.
            </p>
          )}
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
