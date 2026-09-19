/**
 * Complaint and RTI packets.
 *
 * Assembled deterministically from the case: every fact in "Verified project details" is a
 * verified claim with a numbered citation; everything else is labelled as reported, computed
 * or unresolved. No language model writes the facts in a packet. The reporter can edit every
 * section before sending, and the disclaimer says so.
 */
import type { Case, Claim, Evidence, Packet } from "@/lib/schemas";
import { CATEGORY_LABELS, CLAIM_FIELD_LABELS } from "@/lib/schemas";
import type { Authority, Project } from "@/lib/corpus";
import { fmtDate } from "@/lib/agent/finalize";
import { parseDates } from "@/lib/agent/text";
import type { RtiClock } from "@/lib/rti-clock";
import { wordCount } from "@/lib/packet-text";

/** The reporter's own details. Only passed when the packet is built for the owner; public drafts get placeholders. */
export interface ReporterDetails {
  name?: string;
  contact?: string;
}

export const PACKET_DISCLAIMER =
  "Draft prepared with CivicProof. It states only what the cited records say and what the reporter observed; it makes no allegation. Check every detail, add your contact information, and edit as needed before submitting. CivicProof has not sent this to any authority.";

const FIELD_ORDER = [
  "project_name",
  "project_id",
  "agency",
  "contractor",
  "sanctioned_cost",
  "contract_value",
  "estimated_cost",
  "award_date",
  "work_order_date",
  "start_date",
  "completion_date",
  "completion_period",
  "defect_liability",
  "maintenance_cost",
  "roads_covered",
  "scope",
  "work_status",
  "quality_grade",
  "audit_finding",
] as const;

function citeMap(evidence: Evidence[]) {
  // One number per distinct excerpt (same document, page and words), matching the case page.
  const key = (e: Evidence) => `${e.docId}|${e.page ?? 0}|${e.excerpt.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const order = new Map<string, number>();
  const byKey = new Map<string, number>();
  const list: Evidence[] = [];
  for (const e of evidence) {
    if (e.verification !== "verified" && e.verification !== "partially_verified") continue;
    const k = key(e);
    if (!byKey.has(k)) {
      byKey.set(k, byKey.size + 1);
      list.push(e);
    }
    order.set(e.id, byKey.get(k)!);
  }
  return { order, list };
}

const ISSUE_PHRASE: Record<Case["category"], string> = {
  road_damage: "damage to the road surface",
  pothole: "a pothole",
  drainage: "a drainage problem",
  streetlight: "a streetlight fault",
  public_building: "damage to a public building",
  water: "a water infrastructure problem",
  other: "damage to public infrastructure",
};

/** "05-03-2022" → "05-03-2022 (5 Mar 2022)" so day-first dates can't be misread. */
function withReadableDate(claim: Claim): string {
  const v = claim.value ?? claim.text;
  const d = claim.field.endsWith("_date") ? parseDates(v)[0] : undefined;
  return d ? `${v} (${fmtDate(d)})` : v;
}

function refs(claim: Claim, order: Map<string, number>) {
  const n = [...new Set(claim.evidenceIds.map((id) => order.get(id)).filter(Boolean))];
  return n.length ? ` [${n.join(", ")}]` : "";
}

function locationLine(c: Case) {
  const src = {
    photo_exif: "from the photo's GPS metadata",
    device: "from the reporter's device location",
    map_pin: "placed on the map by the reporter",
    geocoded: "geocoded from the address",
    official_record: "from the official record",
  }[c.location.source];
  return `${c.location.address ? c.location.address + " — " : ""}${c.location.lat.toFixed(6)}, ${c.location.lng.toFixed(6)} (${src}). Map: https://www.openstreetmap.org/?mlat=${c.location.lat.toFixed(6)}&mlon=${c.location.lng.toFixed(6)}#map=18/${c.location.lat.toFixed(5)}/${c.location.lng.toFixed(5)}`;
}

export function buildComplaint(c: Case, project: Project | undefined, authority: Authority | undefined, now = new Date(), reporter?: ReporterDetails): Packet {
  const inv = c.investigation;
  // Until the project's identity is established, a complaint must not name it and must not present
  // its records as facts about this location: naming the wrong contract is the harm to avoid.
  const identityEstablished = inv?.determination?.identity.value === "VERIFIED";
  const claims = inv?.claims ?? [];
  const { order, list } = citeMap(inv?.evidence ?? []);
  const verified = identityEstablished ? claims.filter((cl) => cl.verification === "verified" && cl.origin === "official_record") : [];
  // "(computed from the cited dates)" is printed beside this, so it must actually be computed — and
  // it belongs to a project, so it is withheld until that project is established.
  const window = identityEstablished ? claims.find((cl) => cl.field === "maintenance_window" && cl.origin === "computed") : undefined;
  const conflicts = inv?.conflicts ?? [];
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const addressedTo = project?.officer ?? authority?.officer ?? authority?.name ?? "The officer responsible for this road";

  const sections: Packet["sections"] = [];

  sections.push({
    id: "summary",
    heading: "Summary",
    body: [
      `I am reporting ${ISSUE_PHRASE[c.category]} observed on ${fmtDate(c.observedOn)} at ${where}.`,
      project && identityEstablished
        ? `The site falls within "${project.name}", identified by its work identifier in the records cited below${verified.length ? `, from which ${verified.length} detail${verified.length === 1 ? " is" : "s are"} set out below with their sources` : ""}.`
        : project
          ? `A public-works project ("${project.name}") lies at this location in the records available to me, but I could not confirm its work identifier, so I am not attributing this stretch to it. I am asking you to confirm which work covers this spot.`
          : "I could not identify the public-works project for this location from available records.",
      window?.value?.startsWith("inside:") ? window.text : "",
      "I request an inspection and repair, and a written update on the action taken.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  sections.push({
    id: "issue",
    heading: "Reported issue",
    body: [
      `${c.title}.`,
      c.description,
      `Observed on: ${fmtDate(c.observedOn)}. Reported on CivicProof: ${fmtDate(c.reportedAt.slice(0, 10))} (case ${c.id}).`,
      c.photos.length
        ? `${c.photos.length} photo${c.photos.length === 1 ? "" : "s"} attached (SHA-256 fingerprints listed under Supporting evidence).`
        : "No photo attached.",
    ].join("\n\n"),
  });

  sections.push({ id: "location", heading: "Location", body: locationLine(c) });

  if (verified.length || window) {
    const lines: string[] = [];
    const rank = (f: string) => {
      const i = (FIELD_ORDER as readonly string[]).indexOf(f);
      return i === -1 ? FIELD_ORDER.length : i;
    };
    // Every verified fact is listed (the summary counts them), in a readable order.
    for (const cl of [...verified].sort((a, b) => rank(a.field) - rank(b.field))) {
      lines.push(`• ${CLAIM_FIELD_LABELS[cl.field]}: ${withReadableDate(cl)}${refs(cl, order)}`);
    }
    if (window) lines.push(`• Defect liability window: ${window.text}${refs(window, order)} (computed from the cited dates)`);
    sections.push({
      id: "records",
      heading: "Details from official records",
      body: lines.join("\n") + "\n\nNumbers in brackets refer to the Supporting evidence list.",
    });
  }

  const questions = [
    ...conflicts.map((cf) => `• ${CLAIM_FIELD_LABELS[cf.field]}: ${cf.description}`),
    ...(inv?.missing ?? [])
      .filter((m) => project || m.field !== "project_name")
      .map((m) => `• ${m.label}: ${m.reason}${m.requestableRecord ? ` (record: ${m.requestableRecord})` : ""}`),
  ];
  if (questions.length) sections.push({ id: "questions", heading: "Unresolved questions", body: questions.join("\n") });

  const asks = [
    "1. Inspect the reported location and repair the damage.",
    window?.value?.startsWith("inside:")
      ? "2. If the defect falls within the contract's defect liability period, direct the contractor to rectify it under the contract and confirm this in writing."
      : "2. Confirm which agency and contract are responsible for maintaining this stretch.",
    "3. Share an action-taken report with the expected date of repair and the complaint reference number.",
  ];
  sections.push({ id: "request", heading: "Requested action", body: asks.join("\n") });
  sections.push({
    id: "sender",
    heading: "From",
    body: `Name: ${reporter?.name ?? "[Your full name]"}\nContact: ${reporter?.contact ?? "[Phone or email, so the office can reply]"}\nDate: ${fmtDate(now.toISOString().slice(0, 10))}`,
  });

  const evidenceLines = list.map((e, i) => {
    const page = e.page ? `, p. ${e.page}` : "";
    const excerpt = `"${e.excerpt.replace(/\s+/g, " ").slice(0, 280)}"`;
    const source =
      e.sourceType === "user_upload" ? "(copy attached; obtained by the reporter)" : `(retrieved ${e.retrievedAt})${e.sourceUrl ? ` ${e.sourceUrl}` : ""}`;
    return `[${i + 1}] ${e.sourceTitle} — ${e.publisher ?? "publisher not recorded"}${page}. ${excerpt} ${source}`;
  });
  // The original's fingerprint is what the reporter can match against the file on their phone;
  // the stored copy is the resized version CivicProof holds.
  const photoLines = c.photos.map(
    (p, i) =>
      `Photo ${i + 1}: ${p.originalSha256 ? `original file SHA-256 ${p.originalSha256} (computed on the reporter's device); ` : ""}copy held by CivicProof SHA-256 ${p.sha256}${p.exif?.takenAt ? `; taken ${p.exif.takenAt} per EXIF` : ""}${p.credit ? ` — ${p.credit}` : ""}`,
  );
  sections.push({
    id: "evidence",
    heading: "Supporting evidence",
    body: [...evidenceLines, ...photoLines].join("\n") || "No documentary evidence was found; only the reporter's observation is included.",
  });

  return {
    kind: "complaint",
    generatedAt: now.toISOString(),
    addressedTo,
    subject: `${CATEGORY_LABELS[c.category]} at ${where}${project ? ` — ${project.name}` : ""} (CivicProof ${c.id})`,
    sections,
    disclaimer: PACKET_DISCLAIMER,
  };
}

export function buildRti(c: Case, project: Project | undefined, authority: Authority | undefined, now = new Date(), reporter?: ReporterDetails): Packet {
  const inv = c.investigation;
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const work = project ? `the work "${project.name}"` : `road works on the stretch at ${where} (${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)})`;

  // Records for what the investigation could not verify come first, then records any works
  // complaint benefits from.
  const requested = new Set<string>();
  for (const m of inv?.missing ?? []) if (m.requestableRecord) requested.add(m.requestableRecord);
  if (![...requested].some((r) => /completion certificate/i.test(r))) requested.add("Completion certificate and final bill");
  requested.add("Quality control / third-party test reports");
  requested.add("Repairs carried out after completion, including under defect liability, with dates");

  // One subject (this work), and within the authority's word limit where its state rules set one
  // (Karnataka rule 14: ordinarily 150 words). Records that do not fit are listed for a second application.
  const opening = `Subject matter: records of ${work}.\n\nPlease provide certified copies of:`;
  const closing = "If any of this is held by another public authority, please transfer this application under Section 6(3) and inform me.";
  const limit = authority?.rti?.requestWordLimit;
  const items: string[] = [];
  const leftOut: string[] = [];
  for (const r of requested) {
    const next = [opening, ...items, `${items.length + 1}. ${r}.`, closing].join("\n");
    if (limit && items.length > 0 && wordCount(next) > limit) leftOut.push(r);
    else items.push(`${items.length + 1}. ${r}.`);
  }
  const ruleNote = limit
    ? ` ${authority?.rti?.requestRule ?? `The state's RTI rules limit a request to about ${limit} words.`}${leftOut.length ? ` To stay within it, these were left out and can be asked for in a separate application: ${leftOut.join("; ")}.` : ""}`
    : "";

  return {
    kind: "rti",
    generatedAt: now.toISOString(),
    addressedTo: `${authority?.rti?.addressee ?? "The Public Information Officer, [name of the public authority]"}\n[Office address]`,
    subject: "Application for information under Section 6(1) of the Right to Information Act, 2005",
    sections: [
      {
        id: "applicant",
        heading: "Applicant",
        body: `Name: ${reporter?.name ?? "[Your full name]"}\nAddress for correspondence: [Your address]\nPhone / email: ${reporter?.contact ?? "[Optional]"}`,
      },
      {
        id: "information",
        heading: "Information sought",
        body: [opening, ...items, "", closing].join("\n"),
      },
      {
        id: "fee",
        heading: "Fee",
        body: "I enclose the prescribed application fee. Mode of payment: [ ]. [If you hold a below-poverty-line card, say so and attach a copy instead of paying.] If further fees are payable for copies, please intimate the amount.",
      },
      {
        id: "declaration",
        heading: "Declaration",
        body: "I am a citizen of India.\n\nPlace: [ ]\nDate: [ ]\nSignature: [ ]",
      },
    ],
    // No reasons section: Section 6(2) says an applicant need not give one. The case reference
    // stays in the disclaimer, which is guidance for the reporter, not part of the request.
    disclaimer: `Draft RTI application prepared with CivicProof for case ${c.id} (${CATEGORY_LABELS[c.category].toLowerCase()} observed on ${fmtDate(c.observedOn)}).${ruleNote}${authority?.rti?.fee ? ` ${authority.rti.fee}` : ""}${authority?.rti?.note ? ` ${authority.rti.note}` : ""} Check the correct Public Information Officer and fee rules for the authority before filing. A reply is due within 30 days of receipt (Section 7(1)); if none is received, a first appeal lies under Section 19(1). CivicProof has not sent this to any authority.`,
  };
}

/**
 * First appeal under Section 19(1) when an RTI application has gone unanswered.
 * Built only from what the reporter recorded (submission date, channel, reference).
 */
/** Grounds that match what the reporter recorded: no reply in time, or a reply they disagree with. */
function appealGrounds(clock: RtiClock): string[] {
  const outOfTime = clock.daysLeft < 0;
  if (clock.repliedOn) {
    return [
      `The Public Information Officer's reply was received on ${fmtDate(clock.repliedOn)}.${clock.repliedOn > clock.replyDue ? ` That is after ${fmtDate(clock.replyDue)}, when the 30-day period in Section 7(1) ended.` : ""} I am aggrieved by the decision because [say which items were refused, not answered or answered incompletely, and why the reply does not meet the request].`,
      outOfTime
        ? `This appeal is filed after the 30 days allowed by Section 19(1), which ended on ${fmtDate(clock.appealBy)}. I request that the delay be condoned under the proviso to Section 19(1): [state the reason for the delay].`
        : "This appeal is filed within 30 days of receiving the reply, as permitted by Section 19(1).",
    ];
  }
  return [
    `No decision or information was received within 30 days of the application, the period set by Section 7(1). Under Section 7(2) this is deemed a refusal. The reply was due by ${fmtDate(clock.replyDue)}.`,
    outOfTime
      ? `This appeal is filed after the 30 days allowed by Section 19(1), which ended on ${fmtDate(clock.appealBy)}. I request that the delay be condoned under the proviso to Section 19(1): [state the reason for the delay].`
      : "This appeal is filed within 30 days of that date, as permitted by Section 19(1).",
  ];
}

export function buildAppeal(c: Case, project: Project | undefined, authority: Authority | undefined, clock: RtiClock, now = new Date(), reporter?: ReporterDetails): Packet {
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const body = authority?.name ?? "[Name of the public authority]";
  // Section 7(6): information is free when the reply did not come within the time limit.
  const late = !clock.repliedOn || clock.repliedOn > clock.replyDue;
  return {
    kind: "appeal",
    generatedAt: now.toISOString(),
    addressedTo: `The First Appellate Authority, ${body}`,
    subject: "First appeal under Section 19(1) of the Right to Information Act, 2005",
    sections: [
      {
        id: "appellant",
        heading: "Appellant",
        body: `Name: ${reporter?.name ?? "[Your full name]"}\nAddress for correspondence: [Your address]\nPhone / email: ${reporter?.contact ?? "[Optional]"}`,
      },
      {
        id: "application",
        heading: "Particulars of the RTI application",
        body: [
          `Date of application: ${fmtDate(clock.submittedOn)}`,
          clock.channel ? `Filed through: ${clock.channel}` : "",
          clock.referenceNumber ? `Registration / reference number: ${clock.referenceNumber}` : "Registration / reference number: [if any]",
          `Addressed to: ${authority?.rti?.addressee ?? `The Public Information Officer, ${body}`}`,
          `Subject: records relating to ${project ? `"${project.name}"` : `road works at ${where}`} (CivicProof case ${c.id}).`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
      { id: "grounds", heading: "Grounds of appeal", body: appealGrounds(clock).join("\n\n") },
      {
        id: "relief",
        heading: "Relief sought",
        body: [
          "Direct the Public Information Officer to furnish the information sought in the application.",
          ...(late ? ["Since the time limit in Section 7(1) was not complied with, direct that the information be provided free of charge, as provided by Section 7(6)."] : []),
          "Any other order the First Appellate Authority considers appropriate.",
        ]
          .map((r, i) => `${i + 1}. ${r}`)
          .join("\n"),
      },
      {
        id: "enclosures",
        heading: "Enclosures",
        body: ["Copy of the RTI application", "Proof of submission and fee payment", ...(clock.repliedOn ? ["Copy of the reply received"] : [])].map((r, i) => `${i + 1}. ${r}`).join("\n"),
      },
      { id: "declaration", heading: "Declaration", body: "I am a citizen of India. The facts stated above are true to the best of my knowledge.\n\nPlace: [ ]\nDate: [ ]\nSignature: [ ]" },
    ],
    disclaimer:
      "Draft first appeal prepared with CivicProof from the submission details you recorded. Check the name of the First Appellate Authority (an officer senior to the PIO) and any state-specific format before filing. CivicProof has not sent this anywhere.",
  };
}

export { packetToText } from "./packet-text";
