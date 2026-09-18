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

export function buildComplaint(c: Case, project: Project | undefined, authority: Authority | undefined, now = new Date()): Packet {
  const inv = c.investigation;
  const claims = inv?.claims ?? [];
  const { order, list } = citeMap(inv?.evidence ?? []);
  const verified = claims.filter((cl) => cl.verification === "verified" && cl.origin === "official_record");
  const window = claims.find((cl) => cl.field === "maintenance_window");
  const conflicts = inv?.conflicts ?? [];
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const addressedTo = project?.officer ?? authority?.officer ?? authority?.name ?? "The officer responsible for this road";

  const sections: Packet["sections"] = [];

  sections.push({
    id: "summary",
    heading: "Summary",
    body: [
      `I am reporting ${ISSUE_PHRASE[c.category]} observed on ${fmtDate(c.observedOn)} at ${where}.`,
      project
        ? `Based on its location, the site appears to fall within "${project.name}"${verified.length ? `, for which ${verified.length} detail${verified.length === 1 ? " is" : "s are"} set out below with their sources` : ""}.`
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
    for (const f of FIELD_ORDER) {
      for (const cl of verified.filter((x) => x.field === f)) {
        lines.push(`• ${CLAIM_FIELD_LABELS[f]}: ${withReadableDate(cl)}${refs(cl, order)}`);
      }
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
    ...(inv?.missing ?? []).map((m) => `• ${m.label}: ${m.reason}${m.requestableRecord ? ` (record: ${m.requestableRecord})` : ""}`),
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

  const evidenceLines = list.map((e, i) => {
    const page = e.page ? `, p. ${e.page}` : "";
    const where = e.sourceType === "user_upload" ? " (copy attached; obtained by the reporter)" : e.sourceUrl ? ` ${e.sourceUrl}` : "";
    return `[${i + 1}] ${e.sourceTitle} — ${e.publisher ?? "publisher not recorded"}${page}. "${e.excerpt.replace(/\s+/g, " ").slice(0, 280)}"${where} (retrieved ${e.retrievedAt})`;
  });
  const photoLines = c.photos.map((p, i) => `Photo ${i + 1}: SHA-256 ${p.sha256}${p.exif?.takenAt ? `, taken ${p.exif.takenAt} per EXIF` : ""}${p.credit ? ` — ${p.credit}` : ""}`);
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

export function buildRti(c: Case, project: Project | undefined, authority: Authority | undefined, now = new Date()): Packet {
  const inv = c.investigation;
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const work = project ? `"${project.name}"` : `road works on the stretch at ${where} (${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)})`;

  const requested = new Set<string>();
  for (const m of inv?.missing ?? []) if (m.requestableRecord) requested.add(m.requestableRecord);
  // Records any works complaint benefits from, whether or not something is missing.
  requested.add("Completion certificate and final bill");
  requested.add("Quality control / third-party test reports for the work");
  requested.add("Details of repairs carried out on this stretch after completion, including under defect liability, with dates");

  const items = [...requested].map((r, i) => `${i + 1}. Certified copy of: ${r}, in respect of ${work}.`);

  return {
    kind: "rti",
    generatedAt: now.toISOString(),
    addressedTo: authority?.rti?.addressee ?? "The Public Information Officer",
    subject: "Application for information under Section 6(1) of the Right to Information Act, 2005",
    sections: [
      {
        id: "to",
        heading: "To",
        body: `${authority?.rti?.addressee ?? "The Public Information Officer, [name of the public authority]"}\n[Office address]`,
      },
      {
        id: "applicant",
        heading: "Applicant",
        body: "Name: [Your full name]\nAddress for correspondence: [Your address]\nPhone / email: [Optional]",
      },
      {
        id: "information",
        heading: "Information sought",
        body: `${items.join("\n")}\n\nIf any of this information is held by another public authority, please transfer this application under Section 6(3) and inform me.`,
      },
      {
        id: "fee",
        heading: "Fee",
        body: `${authority?.rti?.fee ?? "I enclose the prescribed application fee."} [State the mode of payment.] If I am required to pay further fees for copies, please intimate the amount.`,
      },
      {
        id: "declaration",
        heading: "Declaration",
        body: "I am a citizen of India. The information sought relates to public works funded by public money.\n\nPlace: [ ]\nDate: [ ]\nSignature: [ ]",
      },
      {
        id: "context",
        heading: "Why this is being requested",
        body: `Reference: CivicProof case ${c.id}, ${CATEGORY_LABELS[c.category].toLowerCase()} observed on ${fmtDate(c.observedOn)} at ${where}.${authority?.rti?.note ? `\n\nNote: ${authority.rti.note}` : ""}`,
      },
    ],
    disclaimer:
      "Draft RTI application prepared with CivicProof. Check the correct Public Information Officer and fee rules for the authority before filing. A reply is due within 30 days of receipt (Section 7(1)); if none is received, a first appeal lies under Section 19(1).",
  };
}

/**
 * First appeal under Section 19(1) when an RTI application has gone unanswered.
 * Built only from what the reporter recorded (submission date, channel, reference).
 */
export function buildAppeal(c: Case, project: Project | undefined, authority: Authority | undefined, clock: RtiClock, now = new Date()): Packet {
  const where = c.location.locality ?? c.location.address ?? `${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}`;
  const body = authority?.name ?? "[Name of the public authority]";
  return {
    kind: "appeal",
    generatedAt: now.toISOString(),
    addressedTo: `The First Appellate Authority, ${body}`,
    subject: "First appeal under Section 19(1) of the Right to Information Act, 2005",
    sections: [
      { id: "appellant", heading: "Appellant", body: "Name: [Your full name]\nAddress for correspondence: [Your address]\nPhone / email: [Optional]" },
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
      {
        id: "grounds",
        heading: "Grounds of appeal",
        body: `No decision or information was received within 30 days of the application, the period set by Section 7(1). Under Section 7(2) this is deemed a refusal. The reply was due by ${fmtDate(clock.replyDue)}, and this appeal is filed within 30 days of that date as permitted by Section 19(1).`,
      },
      {
        id: "relief",
        heading: "Relief sought",
        body: "1. Direct the Public Information Officer to furnish the information sought in the application.\n2. Since the time limit was not complied with, direct that the information be provided free of charge, as provided by Section 7(6).\n3. Any other order the First Appellate Authority considers appropriate.",
      },
      { id: "enclosures", heading: "Enclosures", body: "1. Copy of the RTI application\n2. Proof of submission and fee payment" },
      { id: "declaration", heading: "Declaration", body: "I am a citizen of India. The facts stated above are true to the best of my knowledge.\n\nPlace: [ ]\nDate: [ ]\nSignature: [ ]" },
    ],
    disclaimer:
      "Draft first appeal prepared with CivicProof from the submission details you recorded. Check the name of the First Appellate Authority (an officer senior to the PIO) and any state-specific format before filing. CivicProof has not sent this anywhere.",
  };
}

export { packetToText } from "./packet-text";
