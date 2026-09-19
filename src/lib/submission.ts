/**
 * Where a finished packet should be taken.
 *
 * CivicProof never sends anything. It names the office and the official channel it holds for that
 * office, and the citizen submits. So the only question this module answers is whether the
 * destination is one we can stand behind: a channel is reported as verified when the directory
 * holds a URL on an Indian government domain, and otherwise it is not reported at all. A guessed
 * address is worse than none — it sends a complaint into a void, or to the wrong office.
 */
import type { Authority } from "@/lib/corpus";
import type { PacketKind } from "@/lib/schemas";

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
