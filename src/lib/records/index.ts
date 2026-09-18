/**
 * Live public-record sources the investigator can search and fetch, and helpers for pages that
 * show cases citing fetched records.
 */
import "server-only";
import { getCorpus, type Corpus } from "@/lib/corpus";
import { loadRecords } from "./archive";
import { withLiveRecords } from "./overlay";
import { ommas } from "./sources/ommas";
import type { RecordSource } from "./types";

export type { LiveRecord, RecordHit, RecordSource } from "./types";
export { fetchOrReuse, loadRecord } from "./archive";
export { withLiveRecords } from "./overlay";

// The Karnataka procurement portal's tender search sits behind a captcha, so it is not searched here;
// BBMP's works-bill public view is not answering (checked 19 Sep 2026). OMMAS is open.
const SOURCES: RecordSource[] = [ommas];

export function recordSources(): RecordSource[] {
  return SOURCES;
}

/** The source that issued a record id ("kppp-tender-123" → KPPP). */
export function sourceFor(recordId: string): RecordSource | undefined {
  return SOURCES.find((s) => recordId.startsWith(`${s.id}-`));
}

/** The shared corpus plus any archived live records among `ids` (unknown ids are ignored). */
export async function corpusWithRecords(ids: string[]): Promise<Corpus> {
  const base = getCorpus();
  const live = ids.filter((id) => !base.getDocument(id) && sourceFor(id));
  if (!live.length) return base;
  return withLiveRecords(base, await loadRecords(live));
}
