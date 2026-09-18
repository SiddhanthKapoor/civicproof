/**
 * CivicProof domain model.
 *
 * Every factual statement in a case is a Claim. A Claim is only "verified" when it
 * points at Evidence whose excerpt was found, verbatim, in the text of a stored
 * source document (see lib/agent/verifier.ts). Nothing in this file is allowed to
 * carry a fact without also carrying where it came from.
 */
import { z } from "zod";

export const CATEGORIES = [
  "road_damage",
  "pothole",
  "drainage",
  "streetlight",
  "public_building",
  "water",
  "other",
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
  road_damage: "Road damage",
  pothole: "Pothole",
  drainage: "Drainage",
  streetlight: "Streetlight",
  public_building: "Public building",
  water: "Water infrastructure",
  other: "Other public infrastructure",
};

export const STATUSES = [
  "reported",
  "investigating",
  "evidence_found",
  "case_prepared",
  "submitted",
  "awaiting_response",
  "resolved",
  "closed",
] as const;
export const StatusSchema = z.enum(STATUSES);
export type CaseStatus = z.infer<typeof StatusSchema>;

export const STATUS_LABELS: Record<CaseStatus, string> = {
  reported: "Reported",
  investigating: "Investigating",
  evidence_found: "Evidence found",
  case_prepared: "Case prepared",
  submitted: "Submitted",
  awaiting_response: "Awaiting response",
  resolved: "Resolved",
  closed: "Closed",
};

/** Verification ladder, strongest first. */
export const VERIFICATION = [
  "verified",
  "partially_verified",
  "unverified",
  "contradicted",
  "unknown",
] as const;
export const VerificationSchema = z.enum(VERIFICATION);
export type Verification = z.infer<typeof VerificationSchema>;

/** Where a statement originates. Drives the visual treatment in the UI. */
export const ORIGINS = ["official_record", "user_report", "ai_inference", "computed"] as const;
export const OriginSchema = z.enum(ORIGINS);
export type Origin = z.infer<typeof OriginSchema>;

export const SOURCE_TYPES = [
  "official_pdf",
  "official_web",
  "open_data",
  "audit_report",
  "news",
  "user_photo",
  "user_upload",
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const LocationSchema = LatLngSchema.extend({
  address: z.string().max(300).optional(),
  locality: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  /** How the coordinates were obtained — shown next to the location. */
  source: z.enum(["photo_exif", "device", "map_pin", "geocoded", "official_record"]),
});
export type CaseLocation = z.infer<typeof LocationSchema>;

export const PhotoSchema = z.object({
  key: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  /** SHA-256 of the stored file, computed on the server. */
  sha256: z.string().length(64),
  /** SHA-256 of the original file, computed in the reporter's browser before resizing. */
  originalSha256: z.string().length(64).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  /** Read from the original file in the browser (resizing strips EXIF). */
  exif: z
    .object({
      takenAt: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  /** Attribution for photos not taken by the reporter (demo cases only). */
  credit: z.string().optional(),
});
export type Photo = z.infer<typeof PhotoSchema>;

// ---------------------------------------------------------------------------
// Source documents (the corpus)
// ---------------------------------------------------------------------------

export const SourceDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  sourceType: SourceTypeSchema,
  url: z.string().url().optional(),
  retrievedAt: z.string(),
  sha256: z.string().optional(),
  licence: z.string().optional(),
  pageCount: z.number().int().optional(),
  file: z.string().optional(),
  notes: z.string().optional(),
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

// ---------------------------------------------------------------------------
// Evidence & claims
// ---------------------------------------------------------------------------

export const EvidenceSchema = z.object({
  id: z.string(),
  docId: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.string().optional(),
  sourceType: SourceTypeSchema,
  publisher: z.string().optional(),
  retrievedAt: z.string(),
  page: z.number().int().optional(),
  excerpt: z.string(),
  /** Result of the verbatim check of `excerpt` against the stored document text. */
  verification: VerificationSchema,
  strength: z.enum(["strong", "moderate", "weak"]),
  relatedClaimIds: z.array(z.string()),
  checkNote: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const CLAIM_FIELDS = [
  "project_name",
  "project_id",
  "agency",
  "contractor",
  "sanctioned_cost",
  "contract_value",
  "work_order_date",
  "start_date",
  "completion_date",
  "defect_liability",
  "scope",
  "roads_covered",
  "estimated_cost",
  "award_date",
  "completion_period",
  "work_status",
  "maintenance_cost",
  "quality_grade",
  "audit_finding",
  "location_match",
  "maintenance_window",
  "reported_condition",
  "photo_observation",
  "other",
] as const;
export const ClaimFieldSchema = z.enum(CLAIM_FIELDS);
export type ClaimField = z.infer<typeof ClaimFieldSchema>;

export const CLAIM_FIELD_LABELS: Record<ClaimField, string> = {
  project_name: "Project",
  project_id: "Project / work ID",
  agency: "Responsible agency",
  contractor: "Contractor",
  sanctioned_cost: "Sanctioned cost",
  contract_value: "Contract value",
  work_order_date: "Work order date",
  start_date: "Start date",
  completion_date: "Completion date",
  defect_liability: "Defect liability / maintenance period",
  scope: "Planned scope",
  roads_covered: "Roads covered",
  estimated_cost: "Estimated cost put to tender",
  award_date: "Award date",
  completion_period: "Period of completion",
  work_status: "Stage of work",
  maintenance_cost: "Maintenance cost due",
  quality_grade: "Quality inspection",
  audit_finding: "Audit finding",
  location_match: "Location match",
  maintenance_window: "Maintenance window",
  reported_condition: "Reported condition",
  photo_observation: "Photo observation",
  other: "Other",
};

export const ClaimSchema = z.object({
  id: z.string(),
  field: ClaimFieldSchema,
  text: z.string(),
  value: z.string().optional(),
  evidenceIds: z.array(z.string()),
  verification: VerificationSchema,
  confidence: z.number().min(0).max(1),
  origin: OriginSchema,
  notes: z.string().optional(),
  /** For computed claims: the ids of the claims they were derived from. */
  derivedFrom: z.array(z.string()).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const MissingItemSchema = z.object({
  field: ClaimFieldSchema,
  label: z.string(),
  reason: z.string(),
  /** The record that would settle it, e.g. "Contract agreement, clause on defect liability". */
  requestableRecord: z.string().optional(),
});
export type MissingItem = z.infer<typeof MissingItemSchema>;

export const ConflictSchema = z.object({
  field: ClaimFieldSchema,
  claimIds: z.array(z.string()),
  description: z.string(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const NEXT_ACTION_TYPES = [
  "defect_liability_repair_request",
  "grievance_portal",
  "rti_request",
  "follow_up",
  "add_evidence",
] as const;
export const NextActionSchema = z.object({
  type: z.enum(NEXT_ACTION_TYPES),
  title: z.string(),
  rationale: z.string(),
  addressedTo: z.string().optional(),
  channel: z.string().optional(),
  channelUrl: z.string().optional(),
  /** Caveats about the channel (e.g. reachability when checked). */
  channelNote: z.string().optional(),
  basedOnClaimIds: z.array(z.string()),
  priority: z.number().int().min(1).max(5),
  /** "rule": derived deterministically from verified facts. "ai": suggested by the model. */
  origin: z.enum(["rule", "ai"]).default("rule"),
});
export type NextAction = z.infer<typeof NextActionSchema>;

export const ProjectMatchSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  distanceM: z.number(),
  score: z.number(),
  reasons: z.array(z.string()),
});
export type ProjectMatch = z.infer<typeof ProjectMatchSchema>;

export const TraceStepSchema = z.object({
  at: z.string(),
  kind: z.enum(["stage", "tool_call", "tool_result", "decision", "denied", "rejected", "note", "error"]),
  stage: z.string().optional(),
  tool: z.string().optional(),
  summary: z.string(),
  detail: z.unknown().optional(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const InvestigationSchema = z.object({
  runId: z.string(),
  engine: z.enum(["bedrock", "rules"]),
  model: z.string().optional(),
  status: z.enum(["running", "complete", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  matches: z.array(ProjectMatchSchema),
  selectedProjectId: z.string().optional(),
  claims: z.array(ClaimSchema),
  evidence: z.array(EvidenceSchema),
  missing: z.array(MissingItemSchema),
  conflicts: z.array(ConflictSchema),
  nextActions: z.array(NextActionSchema),
  summary: z.string().optional(),
  analysis: z.string().optional(),
  trace: z.array(TraceStepSchema),
  error: z.string().optional(),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number(), modelCalls: z.number() })
    .optional(),
});
export type Investigation = z.infer<typeof InvestigationSchema>;

// ---------------------------------------------------------------------------
// Timeline & packet
// ---------------------------------------------------------------------------

export const TIMELINE_TYPES = [
  "reported",
  "investigation_started",
  "investigation_completed",
  "investigation_failed",
  "packet_generated",
  "packet_edited",
  "complaint_submitted",
  "response_received",
  "follow_up_scheduled",
  "note",
  "status_changed",
  "evidence_added",
] as const;
export const TimelineEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum(TIMELINE_TYPES),
  actor: z.enum(["reporter", "agent", "system"]),
  summary: z.string(),
  channel: z.string().optional(),
  referenceNumber: z.string().optional(),
  date: z.string().optional(),
  followUpDate: z.string().optional(),
  notes: z.string().optional(),
  /** Which document a submission was: drives the statutory clock for RTI applications. */
  packet: z.enum(["complaint", "rti", "appeal"]).optional(),
  fromStatus: StatusSchema.optional(),
  toStatus: StatusSchema.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const PacketSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  body: z.string(),
});
export const PACKET_KINDS = ["complaint", "rti", "appeal"] as const;
export const PacketKindSchema = z.enum(PACKET_KINDS);
export type PacketKind = z.infer<typeof PacketKindSchema>;

export const PacketSchema = z.object({
  kind: PacketKindSchema,
  generatedAt: z.string(),
  editedAt: z.string().optional(),
  addressedTo: z.string(),
  subject: z.string(),
  sections: z.array(PacketSectionSchema),
  disclaimer: z.string(),
});
export type Packet = z.infer<typeof PacketSchema>;

// ---------------------------------------------------------------------------
// Documents the reporter adds (RTI replies, work orders…)
// ---------------------------------------------------------------------------

export const CASE_DOCUMENT_KINDS = ["rti_reply", "work_order", "completion_certificate", "official_letter", "other"] as const;
export const CASE_DOCUMENT_LABELS: Record<(typeof CASE_DOCUMENT_KINDS)[number], string> = {
  rti_reply: "RTI reply",
  work_order: "Work order",
  completion_certificate: "Completion certificate",
  official_letter: "Official letter",
  other: "Other document",
};
export const CaseDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(CASE_DOCUMENT_KINDS),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  sha256: z.string().length(64),
  key: z.string(),
  pagesKey: z.string().optional(),
  pageCount: z.number().int(),
  textPages: z.number().int(),
  /** Set when the text came from OCR rather than the file's own text layer. */
  ocr: z.enum(["textract"]).optional(),
  uploadedAt: z.string(),
});
export type CaseDocument = z.infer<typeof CaseDocumentSchema>;

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export const CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: CategorySchema,
  location: LocationSchema,
  observedOn: z.string(),
  reportedAt: z.string(),
  updatedAt: z.string(),
  photos: z.array(PhotoSchema),
  status: StatusSchema,
  /** Seeded demo report. The report is illustrative; linked official records are real. */
  demo: z.boolean().default(false),
  demoNote: z.string().optional(),
  reporterName: z.string().optional(),
  /** Stored server-side only, never returned by public APIs. */
  reporterContact: z.string().optional(),
  /** sha256 of the owner key issued at creation; required for owner actions. */
  ownerKeyHash: z.string(),
  investigation: InvestigationSchema.optional(),
  packets: z.object({ complaint: PacketSchema.optional(), rti: PacketSchema.optional(), appeal: PacketSchema.optional() }).default({}),
  /** Added by the reporter. Files are private to the reporter; quoted excerpts become evidence. */
  documents: z.array(CaseDocumentSchema).default([]),
  timeline: z.array(TimelineEventSchema),
});
export type Case = z.infer<typeof CaseSchema>;

/** The shape returned by public APIs: private fields removed. */
/**
 * What anyone with the link may see. The reporter's name and contact, and the packets they saved
 * (which they may have filled in with their name and address), stay private to the owner key.
 */
export type PublicCase = Omit<Case, "ownerKeyHash" | "reporterContact" | "reporterName" | "packets"> & { savedPackets: PacketKind[] };

export function toPublicCase(c: Case): PublicCase {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ownerKeyHash, reporterContact, reporterName, packets, ...rest } = c;
  return { ...rest, savedPackets: PACKET_KINDS.filter((k) => packets[k]) };
}

// ---------------------------------------------------------------------------
// Input validation for the report form
// ---------------------------------------------------------------------------

export const NewReportSchema = z.object({
  title: z.string().trim().min(8, "Give the report a short, specific title (at least 8 characters).").max(120),
  description: z
    .string()
    .trim()
    .min(20, "Describe what you saw in at least 20 characters.")
    .max(2000, "Keep the description under 2,000 characters."),
  category: CategorySchema,
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  locationSource: z.enum(["photo_exif", "device", "map_pin", "geocoded"]),
  address: z.string().trim().max(300).optional(),
  observedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker to choose when you saw it.")
    .refine((d) => new Date(d + "T00:00:00Z").getTime() <= Date.now() + 36 * 3600 * 1000, "The observed date can't be in the future."),
  reporterName: z.string().trim().max(80).optional(),
  reporterContact: z.string().trim().max(120).optional(),
});
export type NewReport = z.infer<typeof NewReportSchema>;
