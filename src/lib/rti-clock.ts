/**
 * Statutory clock for an RTI application (Right to Information Act, 2005):
 *   Section 7(1)  – reply within 30 days of receipt
 *   Section 7(2)  – no reply in time is deemed a refusal
 *   Section 19(1) – first appeal within 30 days of that period expiring (or of the reply)
 * Dates are counted from the submission date the reporter recorded.
 */
import type { TimelineEvent } from "@/lib/schemas";

export interface RtiClock {
  submittedOn: string;
  channel?: string;
  referenceNumber?: string;
  replyDue: string;
  appealBy: string;
  state: "waiting" | "overdue" | "replied" | "appeal_window_closed";
  /** Days until the next deadline (negative when past it). */
  daysLeft: number;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

export function rtiClock(timeline: TimelineEvent[], today: string): RtiClock | undefined {
  const submission = [...timeline]
    .filter((e) => e.type === "complaint_submitted" && e.packet === "rti" && e.date)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!submission?.date) return undefined;
  const replied = timeline.some((e) => e.type === "response_received" && e.at > submission.at);
  const replyDue = addDaysIso(submission.date, 30);
  const appealBy = addDaysIso(replyDue, 30);
  const state = replied ? "replied" : today <= replyDue ? "waiting" : today <= appealBy ? "overdue" : "appeal_window_closed";
  return {
    submittedOn: submission.date,
    channel: submission.channel,
    referenceNumber: submission.referenceNumber,
    replyDue,
    appealBy,
    state,
    daysLeft: daysBetween(today, state === "waiting" ? replyDue : appealBy),
  };
}
