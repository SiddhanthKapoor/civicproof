/**
 * Case service: the only place that creates cases or changes them on behalf of people.
 * Every state change is authorized with Cedar (policies/case-actions.cedar) first.
 */
import "server-only";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { getBlobs } from "@/lib/blob";
import { getCorpus } from "@/lib/corpus";
import { authorize } from "@/lib/authz";
import { newCaseId, newId, newOwnerKey, ownerKeyMatches, sha256Hex } from "@/lib/ids";
import { log } from "@/lib/log";
import { buildAppeal, buildComplaint, buildRti } from "@/lib/packet";
import { rtiClock } from "@/lib/rti-clock";
import {
  PacketKindSchema,
  StatusSchema,
  type Case,
  type CaseStatus,
  type NewReport,
  type Packet,
  type PacketKind,
  type Photo,
  type TimelineEvent,
} from "@/lib/schemas";

export class ForbiddenError extends Error {
  constructor(public policies: string[], message = "Not allowed") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Uint8Array) => boolean }> = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Identifies an image by its magic bytes, ignoring whatever type the client claimed. */
export function sniffImage(bytes: Uint8Array) {
  return SIGNATURES.find((s) => s.test(bytes));
}

export const PhotoMetaSchema = z.object({
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  exif: z
    .object({
      takenAt: z.string().max(40).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      make: z.string().max(60).optional(),
      model: z.string().max(60).optional(),
    })
    .optional(),
});

export async function storePhoto(caseId: string, bytes: Uint8Array, meta: z.infer<typeof PhotoMetaSchema>, credit?: string): Promise<Photo> {
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("Unsupported image type");
  const sha256 = sha256Hex(bytes);
  const key = `photos/${caseId.toLowerCase()}/${sha256.slice(0, 20)}.${kind.ext}`;
  await getBlobs().put(key, bytes, kind.mime);
  return { key, mime: kind.mime, bytes: bytes.byteLength, sha256, ...meta, credit };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCase(
  input: NewReport,
  photos: Array<{ bytes: Uint8Array; meta: z.infer<typeof PhotoMetaSchema>; credit?: string }>,
  opts: { demo?: boolean; demoNote?: string; reportedAt?: string } = {},
): Promise<{ caseData: Case; ownerKey: string }> {
  const store = getStore();
  const id = newCaseId();
  const ownerKey = newOwnerKey();
  const now = opts.reportedAt ?? new Date().toISOString();

  const stored: Photo[] = [];
  for (const p of photos) stored.push(await storePhoto(id, p.bytes, p.meta, p.credit));

  const locality = input.address?.split(",").slice(0, 2).join(",").trim() || undefined;
  const caseData: Case = {
    id,
    title: input.title,
    description: input.description,
    category: input.category,
    location: {
      lat: input.lat,
      lng: input.lng,
      address: input.address,
      locality,
      city: undefined,
      source: input.locationSource,
    },
    observedOn: input.observedOn,
    reportedAt: now,
    updatedAt: now,
    photos: stored,
    status: "reported",
    demo: opts.demo ?? false,
    demoNote: opts.demoNote,
    reporterName: input.reporterName || undefined,
    reporterContact: input.reporterContact || undefined,
    ownerKeyHash: sha256Hex(ownerKey),
    packets: {},
    timeline: [
      {
        id: newId("ev"),
        at: now,
        type: "reported",
        actor: "reporter",
        summary: `Reported${stored.length ? ` with ${stored.length} photo${stored.length === 1 ? "" : "s"}` : ""}`,
      },
    ],
  };
  await store.create(caseData);
  log.info("case.created", { caseId: id, category: input.category, photos: stored.length, demo: caseData.demo });
  return { caseData, ownerKey };
}

// ---------------------------------------------------------------------------
// Owner actions: tracking what happened in the real world
// ---------------------------------------------------------------------------

export const TimelineInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("complaint_submitted"),
    channel: z.string().trim().min(2, "Say where you submitted it.").max(120),
    referenceNumber: z.string().trim().max(80).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the submission date."),
    packet: z.enum(["complaint", "rti"]).default("complaint"),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({
    type: z.literal("response_received"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of the response."),
    referenceNumber: z.string().trim().max(80).optional(),
    notes: z.string().trim().min(3, "Summarise the response.").max(2000),
  }),
  z.object({
    type: z.literal("follow_up_scheduled"),
    followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a follow-up date."),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({ type: z.literal("note"), notes: z.string().trim().min(3, "Write a note.").max(2000) }),
  z.object({ type: z.literal("status_changed"), toStatus: StatusSchema, notes: z.string().trim().max(1000).optional() }),
]);
export type TimelineInput = z.infer<typeof TimelineInputSchema>;

const ACTION_FOR: Record<TimelineInput["type"], Parameters<typeof authorize>[1]> = {
  complaint_submitted: "RecordSubmission",
  response_received: "RecordResponse",
  follow_up_scheduled: "AddNote",
  note: "AddNote",
  status_changed: "ChangeStatus",
};

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function recordTimeline(caseId: string, ownerKey: string | null, input: TimelineInput): Promise<Case> {
  const store = getStore();
  const current = await store.get(caseId);
  if (!current) throw new Error("Case not found");
  const isOwner = ownerKeyMatches(ownerKey, current.ownerKeyHash);

  let toStatus: CaseStatus | undefined;
  if (input.type === "complaint_submitted") toStatus = "submitted";
  if (input.type === "response_received" || input.type === "follow_up_scheduled") toStatus = current.status === "submitted" ? "awaiting_response" : undefined;
  if (input.type === "status_changed") toStatus = input.toStatus;

  const principal = isOwner ? ({ type: "Reporter", id: caseId } as const) : ({ type: "Public", id: "anonymous" } as const);
  for (const [action, ctx] of [
    [ACTION_FOR[input.type], { is_owner: isOwner, to_status: toStatus }],
    ...(toStatus ? [["ChangeStatus", { is_owner: isOwner, to_status: toStatus }] as const] : []),
  ] as const) {
    const d = authorize(principal, action, caseId, ctx);
    if (!d.allowed) throw new ForbiddenError(d.policies, isOwner ? "This action isn't allowed for this case." : "Only the person who filed this report can record this. Use the owner key you received when reporting.");
  }

  const at = new Date().toISOString();
  const events: TimelineEvent[] = [];
  if (input.type === "complaint_submitted") {
    // RTI: reply due within 30 days (Section 7(1)). Complaints: a suggested 14-day follow-up, not a legal deadline.
    const due = addDays(input.date, input.packet === "rti" ? 30 : 14);
    events.push({
      id: newId("ev"),
      at,
      type: "complaint_submitted",
      actor: "reporter",
      summary: `${input.packet === "rti" ? "RTI application" : "Complaint"} submitted via ${input.channel}`,
      channel: input.channel,
      referenceNumber: input.referenceNumber,
      date: input.date,
      followUpDate: due,
      notes: input.notes,
      packet: input.packet,
    });
  } else if (input.type === "response_received") {
    events.push({ id: newId("ev"), at, type: "response_received", actor: "reporter", summary: "Response received", date: input.date, referenceNumber: input.referenceNumber, notes: input.notes });
  } else if (input.type === "follow_up_scheduled") {
    events.push({ id: newId("ev"), at, type: "follow_up_scheduled", actor: "reporter", summary: "Follow-up scheduled", followUpDate: input.followUpDate, notes: input.notes });
  } else if (input.type === "note") {
    events.push({ id: newId("ev"), at, type: "note", actor: "reporter", summary: "Note added", notes: input.notes });
  }
  if (toStatus && toStatus !== current.status) {
    events.push({ id: newId("ev"), at, type: "status_changed", actor: "reporter", summary: "Status changed", fromStatus: current.status, toStatus, notes: input.type === "status_changed" ? input.notes : undefined });
  }

  const updated = await store.update(caseId, (c) => ({ ...c, status: toStatus ?? c.status, timeline: [...c.timeline, ...events] }));
  log.info("case.timeline", { caseId, type: input.type, toStatus });
  return updated;
}

// ---------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------

export function draftPacket(c: Case, kind: PacketKind): Packet {
  const corpus = getCorpus();
  const project = c.investigation?.selectedProjectId ? corpus.getProject(c.investigation.selectedProjectId) : undefined;
  const authority = corpus.getAuthority(project?.agencyId);
  if (kind === "appeal") {
    const clock = rtiClock(c.timeline, new Date().toISOString().slice(0, 10));
    if (!clock) throw new ForbiddenError([], "A first appeal needs a recorded RTI submission. Record the RTI application in Tracking first.");
    return buildAppeal(c, project, authority, clock);
  }
  return kind === "rti" ? buildRti(c, project, authority) : buildComplaint(c, project, authority);
}

export const PacketEditSchema = z.object({
  kind: PacketKindSchema,
  addressedTo: z.string().trim().min(2).max(200),
  subject: z.string().trim().min(4).max(300),
  sections: z
    .array(z.object({ id: z.string().max(40), heading: z.string().trim().min(1).max(120), body: z.string().max(12000) }))
    .min(1)
    .max(20),
});

/** Generates (or regenerates) a packet and stores it. Owners may save edited sections. */
export async function savePacket(caseId: string, ownerKey: string | null, kind: PacketKind, edit?: z.infer<typeof PacketEditSchema>): Promise<Case> {
  const store = getStore();
  const current = await store.get(caseId);
  if (!current) throw new Error("Case not found");
  const isOwner = ownerKeyMatches(ownerKey, current.ownerKeyHash);

  if (edit) {
    const d = authorize(isOwner ? { type: "Reporter", id: caseId } : { type: "Public", id: "anonymous" }, "EditPacket", caseId, { is_owner: isOwner });
    if (!d.allowed) throw new ForbiddenError(d.policies, "Only the reporter can save edits. You can still copy or download your edited version.");
  }

  const at = new Date().toISOString();
  return store.update(caseId, (c) => {
    const base = draftPacket(c, kind);
    const packet: Packet = edit ? { ...base, addressedTo: edit.addressedTo, subject: edit.subject, sections: edit.sections, editedAt: at } : base;
    const moveToPrepared =
      !edit && ["reported", "investigating", "evidence_found"].includes(c.status) &&
      authorize({ type: "Agent", id: "investigator" }, "ChangeStatus", caseId, { to_status: "case_prepared" }).allowed &&
      c.investigation?.status === "complete";
    return {
      ...c,
      status: moveToPrepared ? "case_prepared" : c.status,
      packets: { ...c.packets, [kind]: packet },
      timeline: [
        ...c.timeline,
        {
          id: newId("ev"),
          at,
          type: edit ? "packet_edited" : "packet_generated",
          actor: edit ? "reporter" : "system",
          summary: `${kind === "rti" ? "RTI application" : kind === "appeal" ? "First appeal" : "Complaint packet"} ${edit ? "edited by the reporter" : "drafted"}`,
        },
      ],
    };
  });
}
