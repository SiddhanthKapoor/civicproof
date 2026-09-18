/**
 * Public records the investigator finds and fetches at run time from official portals, as opposed to
 * the curated corpus shipped with the app. Each fetched record is archived with its URL, retrieval
 * time and SHA-256, rendered to text pages, and then cited and verified like any curated document.
 */
import type { SourceDocument } from "@/lib/schemas";

/** A search result: enough to decide whether to fetch the record. Nothing here is cited. */
export interface RecordHit {
  /** Stable id used by the agent and in URLs, e.g. "kppp-tender-326856". */
  id: string;
  source: string;
  title: string;
  reference?: string;
  department?: string;
  location?: string;
  date?: string;
  status?: string;
  value?: string;
}

/** A fetched record, as archived. `pages` is what quotes are checked against. */
export interface LiveRecord {
  id: string;
  source: string;
  title: string;
  publisher: string;
  sourceType: SourceDocument["sourceType"];
  /** The official URL the bytes came from (API or file). */
  url: string;
  /** A page on the portal a person can open, when there is one. */
  viewUrl?: string;
  retrievedAt: string;
  /** SHA-256 of the raw response(s) as received. */
  sha256: string;
  pages: string[];
  reference?: string;
  department?: string;
  location?: string;
  /** Road or place names taken from the record's title, for linking by name. */
  roadNames: string[];
  notes?: string;
}

export interface RecordSource {
  id: string;
  label: string;
  /** What the search covers, for the model's tool description. */
  covers: string;
  /** `hint` is where the report is (revenue district, locality), for sources organised by district. */
  search(text: string, limit: number, hint?: { district?: string; locality?: string }): Promise<RecordHit[]>;
  fetch(id: string): Promise<LiveRecord>;
}
