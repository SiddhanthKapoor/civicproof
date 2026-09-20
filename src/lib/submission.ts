/**
 * Where a finished packet should be taken.
 *
 * CivicProof never sends anything. It names the office and the official channel it holds for that
 * office, and the citizen submits. So the only question this module answers is whether the
 * destination is one we can stand behind: a channel is reported as verified when the directory
 * holds a URL on an Indian government domain, and otherwise it is not reported at all. A guessed
 * address is worse than none — it sends a complaint into a void, or to the wrong office.
 *
 * `nextSteps` is the rest of that answer: the six things a citizen does with a finished packet, in
 * fixed code-authored wording, each marked as done only when the case's own timeline evidences it.
 */
import type { Authority } from "@/lib/corpus";
import type { CaseStatus, PacketKind, TimelineEvent } from "@/lib/schemas";
import { fmtDate } from "@/lib/agent/text";

export interface SubmissionDestination {
  /** True only when the channel URL is on a government domain. */
  verified: boolean;
  authority?: string;
  channel?: string;
  url?: string;
  /** How a person files it, in plain words. */
  method?: string;
  /** Caveats the directory records, e.g. a site that did not answer when it was checked. */
  note?: string;
  /** Where the directory read this channel from. */
  sourceUrl?: string;
}

/** Government of India and state domains. A channel anywhere else is not treated as official. */
const OFFICIAL_DOMAIN = /(^|\.)(gov\.in|nic\.in)$/i;

export function isOfficialGovernmentUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && OFFICIAL_DOMAIN.test(u.hostname);
  } catch {
    return false;
  }
}

export const UNVERIFIED_CHANNEL =
  "Submission channel not verified. Please use the relevant authority's official website to identify the current grievance channel.";

export function submissionDestination(kind: PacketKind, authority: Authority | undefined): SubmissionDestination {
  if (!authority) return { verified: false };

  if (kind === "complaint") {
    const g = authority.grievance;
    if (!isOfficialGovernmentUrl(g?.url)) return { verified: false, authority: authority.name };
    return {
      verified: true,
      authority: authority.name,
      channel: g!.name,
      url: g!.url,
      method: "Online, through the portal below. You sign in and complete any CAPTCHA or other check yourself.",
      note: g!.note,
      sourceUrl: g!.sourceUrl,
    };
  }

  // An RTI application or a first appeal goes to the Public Information Officer. The state portal
  // is the online route; where there is none, it is filed on paper, which is still a real channel.
  const r = authority.rti;
  if (!r) return { verified: false, authority: authority.name };
  if (!isOfficialGovernmentUrl(r.portalUrl)) {
    return {
      verified: true,
      authority: authority.name,
      channel: r.addressee,
      method: "By post or in person to the Public Information Officer named in the draft, with the prescribed fee.",
      note: r.note ?? r.fee,
      sourceUrl: r.sourceUrl,
    };
  }
  return {
    verified: true,
    authority: authority.name,
    channel: "RTI Online (Karnataka)",
    url: r.portalUrl,
    method: "Online, through the portal below. You register, complete any CAPTCHA yourself, and pay the fee.",
    note: [r.fee, r.note].filter(Boolean).join(" ") || undefined,
    sourceUrl: r.sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// What to do next — the six steps, and what the case records of each
// ---------------------------------------------------------------------------

export interface NextStep {
  n: number;
  /** The imperative, short enough to scan. */
  title: string;
  /** What it means in practice, in plain words. */
  detail: string;
  /** Where in CivicProof the step is carried out. */
  href?: string;
  linkLabel?: string;
  /** The authority's channel — present only when the directory holds a government URL for it. */
  channel?: { label: string; url: string };
  /** Shown instead of a channel link when no official URL could be verified. */
  note?: string;
  /**
   * What the case actually records for this step. Present only when a timeline event evidences it:
   * CivicProof never marks a step done because it looks likely, and never because it was told to.
   */
  recorded?: string;
}

/**
 * The practical procedure, identical for every case and evidence-backed at every step.
 *
 * The wording is fixed in code, so what a citizen is told to do never varies with model output.
 * What *does* vary is `recorded`, and only ever from the case's own timeline — a submission is
 * shown as made because the reporter recorded making it, never because CivicProof sent anything.
 * CivicProof does not submit, sign in, or answer a CAPTCHA on anyone's behalf.
 */
export function nextSteps(input: {
  caseId: string;
  timeline: TimelineEvent[];
  destination?: Pick<SubmissionDestination, "verified" | "channel" | "url">;
  status: CaseStatus;
}): NextStep[] {
  const { caseId, timeline, destination, status } = input;
  const on = (e: TimelineEvent) => e.date ?? e.at.slice(0, 10);
  const of = (t: TimelineEvent["type"]) => timeline.filter((e) => e.type === t);

  const submitted = of("complaint_submitted").sort((a, b) => on(a).localeCompare(on(b))).at(-1);
  const reference = submitted?.referenceNumber;
  const responses = of("response_received").length;
  const followUps = of("evidence_added").length;
  const outcome = status === "resolved" ? "Case recorded as resolved." : status === "closed" ? "Case recorded as closed." : undefined;

  // A channel is offered as a link only when it is on a government domain; otherwise the citizen is
  // told to find the current one themselves, which is the honest answer to a channel we cannot vouch for.
  const channel =
    destination?.verified && isOfficialGovernmentUrl(destination.url)
      ? { label: destination.channel ?? "Official grievance portal", url: destination.url! }
      : undefined;

  return [
    {
      n: 1,
      title: "Review the evidence",
      detail:
        "Read the verified facts and the open questions on this page. Each fact links to the page of the record it is quoted from, so you can check it yourself before anything is sent.",
      href: "#evidence",
      linkLabel: "Go to the evidence",
    },
    {
      n: 2,
      title: "Open the official submission channel",
      detail:
        "Open the authority's own grievance channel in a new tab. CivicProof does not submit on your behalf and does not complete any sign-in, consent or CAPTCHA step for you.",
      ...(channel ? { channel } : { note: UNVERIFIED_CHANNEL }),
    },
    {
      n: 3,
      title: "Submit the complaint and evidence",
      detail:
        "Copy the complaint text or download the packet, then file it through that channel with the photograph attached. The packet is a draft: read it through and edit anything that does not match what you saw.",
      href: `/cases/${caseId}/packet?kind=complaint`,
      linkLabel: "Open the complaint packet",
      ...(submitted ? { recorded: `Submission recorded on ${fmtDate(on(submitted))}${submitted.channel ? ` through ${submitted.channel}` : ""}.` } : {}),
    },
    {
      n: 4,
      title: "Record the official complaint or reference number in CivicProof",
      detail:
        "When the portal returns an acknowledgement or reference number, record it here with the date and channel. That number is what lets the submission be followed up later.",
      href: "#tracking",
      linkLabel: "Record the submission",
      ...(reference ? { recorded: `Reference ${reference} recorded.` } : {}),
    },
    {
      n: 5,
      title: "Add authority responses or follow-up photographs",
      detail:
        "If the authority replies, record the reply. If you photograph the same spot again later, add it to the case. Both are kept as dated evidence beside the original report.",
      href: "#tracking",
      linkLabel: "Add a response or a photograph",
      ...(responses || followUps
        ? {
            recorded: [
              responses ? `${responses} authority response${responses === 1 ? "" : "s"}` : "",
              followUps ? `${followUps} follow-up document${followUps === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" and ") + " recorded.",
          }
        : {}),
    },
    {
      n: 6,
      title: "Track the case until an outcome is documented",
      detail:
        "Keep the case updated until there is a documented outcome — repaired, refused, or closed. The timeline keeps every step in the order it happened, which is the record of what the authority did.",
      href: "#tracking",
      linkLabel: "Open the timeline",
      ...(outcome ? { recorded: outcome } : {}),
    },
  ];
}
