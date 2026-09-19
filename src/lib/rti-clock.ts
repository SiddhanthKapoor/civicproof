/**
 * Statutory clock for an RTI application (Right to Information Act, 2005):
 *   Section 7(1)  – reply within 30 days of receipt
 *   Section 7(2)  – no reply in time is deemed a refusal
 *   Section 19(1) – first appeal within 30 days of that period expiring, or of receiving the reply
 * Dates are counted from the submission date the reporter recorded.
 */
import type { TimelineEvent } from "@/lib/schemas";

export interface RtiClock {
  submittedOn: string;
  channel?: string;
  referenceNumber?: string;
  replyDue: string;
  /** Date of the first response recorded after the application, if any. */
  repliedOn?: string;
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
  // Ordered by the dates the reporter recorded, not by when the rows were written: two events
  // recorded in the same millisecond must not make the reply invisible.
  const reply = timeline
    .filter((e) => e.type === "response_received")
    .map((e) => ({ at: e.at, on: e.date ?? e.at.slice(0, 10) }))
    .filter((r) => r.on >= submission.date! && r.at >= submission.at)
    .sort((a, b) => a.on.localeCompare(b.on) || a.at.localeCompare(b.at))[0];
  const repliedOn = reply?.on;
  const replyDue = addDaysIso(submission.date, 30);
  const appealBy = addDaysIso(repliedOn ?? replyDue, 30);
  const state = repliedOn ? "replied" : today <= replyDue ? "waiting" : today <= appealBy ? "overdue" : "appeal_window_closed";
  return {
    submittedOn: submission.date,
    channel: submission.channel,
    referenceNumber: submission.referenceNumber,
    replyDue,
    repliedOn,
    appealBy,
    state,
    daysLeft: daysBetween(today, state === "waiting" ? replyDue : appealBy),
  };
}
