import { normalizeText } from "@/lib/agent/text";

/**
 * Finds `q` in page text, tolerating the whitespace and typography differences PDF extraction
 * introduces. Returns [start, end) offsets in the original text, or null.
 */
export function locateExcerpt(text: string, q: string): [number, number] | null {
  const target = normalizeText(q).replace(/\s+/g, "");
  if (target.length < 6) return null;
  const map: number[] = [];
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    for (const ch of normalizeText(text[i]).replace(/\s+/g, "")) {
      flat += ch;
      map.push(i);
    }
  }
  const at = flat.indexOf(target);
  if (at < 0) return null;
  return [map[at], map[at + target.length - 1] + 1];
}
