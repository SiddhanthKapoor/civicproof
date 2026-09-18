import { z } from "zod";
import { CategorySchema, ClaimFieldSchema, SourceDocumentSchema } from "@/lib/schemas";

export const CitationSchema = z.object({
  docId: z.string(),
  page: z.number().int().min(1),
  quote: z.string().min(6),
});

/** A human-curated extraction, checked verbatim against the document text at ingest. */
export const ReferenceFieldSchema = z.object({
  field: ClaimFieldSchema,
  text: z.string(),
  value: z.string().optional(),
  citations: z.array(CitationSchema).min(1),
  notes: z.string().optional(),
});

const Coord = z.tuple([z.number(), z.number()]);
export const GeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: Coord }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(Coord).min(2) }),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(Coord).min(2)).min(1) }),
]);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  roadNames: z.array(z.string()).default([]),
  locality: z.string().optional(),
  city: z.string(),
  state: z.string(),
  agencyId: z.string().optional(),
  /** Addressee for this project's complaints, when an official document names the office. */
  officer: z.string().optional(),
  categories: z.array(CategorySchema).min(1),
  /** Loaded from corpus/geometry/projects.geojson when not given inline. */
  geometry: GeometrySchema.optional(),
  /** Where the coordinates came from; official records rarely publish geometry. */
  geometrySource: z.object({
    // "none": a record fetched at run time with no map location, linked by road name.
    kind: z.enum(["official", "openstreetmap", "geocoded", "none"]),
    note: z.string(),
    url: z.string().optional(),
  }),
  documents: z.array(z.string()).min(1),
  reference: z.array(ReferenceFieldSchema).default([]),
  /** One-line neutral description shown in listings. */
  summary: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const AuthoritySchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  jurisdiction: z.string(),
  grievance: z
    .object({ name: z.string(), url: z.string().optional(), note: z.string().optional(), sourceUrl: z.string().optional() })
    .optional(),
  rti: z
    .object({
      addressee: z.string(),
      portalUrl: z.string().optional(),
      fee: z.string().optional(),
      note: z.string().optional(),
      sourceUrl: z.string().optional(),
      /** State RTI rules that cap the length of a request, e.g. Karnataka rule 14 (150 words). */
      requestWordLimit: z.number().int().positive().optional(),
      requestRule: z.string().optional(),
    })
    .optional(),
  officer: z.string().optional(),
});
export type Authority = z.infer<typeof AuthoritySchema>;

export const ManifestSchema = z.object({
  version: z.number(),
  description: z.string(),
  documents: z.array(SourceDocumentSchema),
});

export const PagesFileSchema = z.record(
  z.string(),
  z.object({ sha256: z.string().optional(), pages: z.array(z.string()) }),
);
