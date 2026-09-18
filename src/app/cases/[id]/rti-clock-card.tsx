"use client";

import Link from "next/link";
import type { TimelineEvent } from "@/lib/schemas";
import { rtiClock } from "@/lib/rti-clock";
import { buttonClass, formatDate } from "@/components/ui";
import { cn } from "@/lib/utils";

const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Shows where an RTI application stands against the Act's deadlines, and offers the next step. */
export function RtiClockCard({ caseId, timeline }: { caseId: string; timeline: TimelineEvent[] }) {
  const clock = rtiClock(timeline, todayIst());
  if (!clock) return null;
  const tone =
    clock.state === "replied" ? "border-verified/30 bg-verified-soft/50" : clock.state === "waiting" ? "border-rule bg-card" : "border-contradicted/30 bg-contradicted-soft/50";
  const steps = [
    { label: "Filed", date: clock.submittedOn, done: true },
    clock.repliedOn
      ? { label: "Reply received", date: clock.repliedOn, done: true }
      : { label: "Reply due · s.7(1)", date: clock.replyDue, done: clock.state !== "waiting" },
    { label: "First appeal by · s.19(1)", date: clock.appealBy, done: clock.state === "appeal_window_closed" },
  ];
  return (
    <div className={cn("rounded-2xl border p-5 shadow-card", tone)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">RTI statutory clock</p>
          <p className="mt-1.5 max-w-xl text-[15px] font-medium leading-snug">
            {clock.state === "waiting" && `Reply due by ${formatDate(clock.replyDue)}: ${clock.daysLeft} day${clock.daysLeft === 1 ? "" : "s"} left.`}
            {clock.state === "overdue" && `No reply recorded by ${formatDate(clock.replyDue)}. Under Section 7(2) that is a deemed refusal; a first appeal can be filed until ${formatDate(clock.appealBy)}.`}
            {clock.state === "replied" &&
              (clock.daysLeft >= 0
                ? `A reply was recorded on ${formatDate(clock.repliedOn!)}. If it refuses or leaves out information, a first appeal lies until ${formatDate(clock.appealBy)} (Section 19(1)).`
                : `A reply was recorded on ${formatDate(clock.repliedOn!)}. The 30 days for a first appeal ended on ${formatDate(clock.appealBy)}; the First Appellate Authority may still admit a late appeal for sufficient cause.`)}
            {clock.state === "appeal_window_closed" && `The 30-day window for a first appeal ended on ${formatDate(clock.appealBy)}. The First Appellate Authority may still admit a late appeal for sufficient cause (proviso to Section 19(1)).`}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Filed {formatDate(clock.submittedOn)}
            {clock.channel ? ` via ${clock.channel}` : ""}
            {clock.referenceNumber ? ` · ref. ${clock.referenceNumber}` : ""}
          </p>
        </div>
        {(clock.state === "overdue" || clock.state === "replied") && (
          <Link href={`/cases/${caseId}/packet?kind=appeal`} className={buttonClass(clock.state === "overdue" ? "primary" : "secondary", "sm")}>
            Draft the first appeal
          </Link>
        )}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.label} className={cn("rounded-xl border px-3 py-2", s.done ? "border-ink/20 bg-card" : "border-dashed border-rule-strong")}>
            <p className="text-[11.5px] text-ink-3">{s.label}</p>
            <p className="tnum font-mono text-[13px] text-ink">{formatDate(s.date)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
