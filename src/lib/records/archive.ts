/**
 * Archive of fetched public records: S3 on AWS, files locally (the blob store). A record fetched
 * once is reused for 7 days, so cases cite the same bytes and portals aren't hit repeatedly.
 */
import "server-only";
import { getBlobs } from "@/lib/blob";
import { log } from "@/lib/log";
import type { LiveRecord } from "./types";

const FRESH_MS = 7 * 24 * 3600 * 1000;
const key = (id: string) => `records/${id}.json`;

export async function loadRecord(id: string): Promise<LiveRecord | undefined> {
  const blob = await getBlobs().get(key(id)).catch(() => null);
  if (!blob) return undefined;
  return JSON.parse(new TextDecoder().decode(blob.body)) as LiveRecord;
}

export async function saveRecord(record: LiveRecord): Promise<void> {
  await getBlobs().put(key(record.id), new TextEncoder().encode(JSON.stringify(record)), "application/json");
  log.info("record.archived", { id: record.id, sha256: record.sha256, pages: record.pages.length });
}

/** The archived copy if it is fresh, else a new fetch (archived before it is returned). */
export async function fetchOrReuse(id: string, fetcher: (id: string) => Promise<LiveRecord>): Promise<{ record: LiveRecord; reused: boolean }> {
  const existing = await loadRecord(id);
  if (existing && Date.now() - Date.parse(existing.retrievedAt) < FRESH_MS) return { record: existing, reused: true };
  const record = await fetcher(id);
  await saveRecord(record);
  return { record, reused: false };
}

export async function loadRecords(ids: string[]): Promise<LiveRecord[]> {
  const out = await Promise.all([...new Set(ids)].map((id) => loadRecord(id)));
  return out.filter((r): r is LiveRecord => Boolean(r));
}
