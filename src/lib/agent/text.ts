/**
 * Text normalisation and value parsing used by the grounding verifier.
 * Pure functions, no I/O — covered by tests/verifier.test.ts.
 */

/** Canonical form for comparing an excerpt with extracted document text. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[​-‍﻿]/g, "") // zero-width
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/₹/g, " rs ")
    .replace(/\brs\.?(?=\s|\d)/gi, " rs ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes all whitespace — tolerates PDF extraction that splits or joins words. */
export function squash(s: string): string {
  return normalizeText(s).replace(/\s+/g, "");
}

export type QuoteMatch =
  | { kind: "exact" }
  | { kind: "fuzzy"; coverage: number }
  | { kind: "none"; coverage: number };

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 2);
}

/**
 * Does `quote` occur in `pageText`? Exact (modulo whitespace/typography) is required for
 * "verified". A fuzzy in-order token match (≥ 85% of tokens) is reported so the UI can say
 * "excerpt closely matches page N — check the wording" rather than silently accepting it.
 */
export function findQuote(pageText: string, quote: string): QuoteMatch {
  const q = normalizeText(quote);
  if (q.length < 6) return { kind: "none", coverage: 0 };
  const page = normalizeText(pageText);
  if (page.includes(q)) return { kind: "exact" };
  if (squash(pageText).includes(squash(quote))) return { kind: "exact" };

  const qt = tokens(quote);
  if (qt.length === 0) return { kind: "none", coverage: 0 };
  const pt = tokens(pageText);
  // Greedy in-order subsequence match, restarting from each occurrence of the first tokens.
  let best = 0;
  for (let start = 0; start < pt.length; start++) {
    if (pt[start] !== qt[0] && pt[start] !== qt[1]) continue;
    let i = start;
    let hit = 0;
    const windowEnd = Math.min(pt.length, start + qt.length * 2 + 10);
    for (const t of qt) {
      let j = i;
      while (j < windowEnd && pt[j] !== t) j++;
      if (j < windowEnd) {
        hit++;
        i = j + 1;
      }
    }
    best = Math.max(best, hit / qt.length);
    if (best === 1) break;
  }
  return best >= 0.85 ? { kind: "fuzzy", coverage: best } : { kind: "none", coverage: best };
}

// ---------------------------------------------------------------------------
// Values: money and dates
// ---------------------------------------------------------------------------

const UNIT: Record<string, number> = {
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  million: 1e6,
  mn: 1e6,
  thousand: 1e3,
};

/**
 * Extracts rupee amounts from text, applying Indian units: "Rs. 1,25,00,000", "₹ 12.5 crore",
 * "125.40 lakhs", "Rs.4.20 Cr". Returns amounts in rupees.
 */
export function parseAmounts(text: string): number[] {
  const t = normalizeText(text);
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|million|mn|thousand)?\b/g;
  for (const m of t.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = m[2] ? UNIT[m[2]] : 1;
    out.push(Math.round(n * unit));
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Extracts calendar dates (Indian day-first convention for numeric forms) as ISO strings. */
export function parseDates(text: string): string[] {
  const t = normalizeText(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) out.add(v);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g)) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const v = iso(y, +m[2], +m[1]);
    if (v) out.add(v);
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})\b/g)) {
    const mo = MONTHS[m[2]];
    if (mo) {
      const v = iso(+m[3], mo, +m[1]);
      if (v) out.add(v);
    }
  }
  for (const m of t.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1]];
    if (mo) {
      const v = iso(+m[3], mo, +m[2]);
      if (v) out.add(v);
    }
  }
  return [...out];
}

/** Durations such as "5 years", "24 months", "two years" → months. */
export function parseDurationsMonths(text: string): number[] {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twelve: 12 };
  const t = normalizeText(text);
  const out: number[] = [];
  for (const m of t.matchAll(/\b(\d{1,3}|one|two|three|four|five|six|ten|twelve)[\s-]*(?:\(\s*\w+\s*\)[\s-]*)?(years?|yrs?|months?)\b/g)) {
    const n = /\d/.test(m[1]) ? Number(m[1]) : words[m[1]];
    out.push(m[2].startsWith("y") ? n * 12 : n);
  }
  return out;
}

/**
 * Is `value` supported by `quote`? Literal match first, then semantic equality for money,
 * dates and durations so "₹1.25 crore" is supported by "Rs. 125.00 lakhs".
 */
export function valueSupported(value: string, quote: string): boolean {
  const v = squash(value);
  if (v.length === 0) return false;
  if (squash(quote).includes(v)) return true;

  const vAmounts = parseAmounts(value).filter((n) => n >= 1000);
  if (vAmounts.length) {
    const qAmounts = new Set(parseAmounts(quote));
    if (vAmounts.some((a) => qAmounts.has(a))) return true;
  }
  const vDates = parseDates(value);
  if (vDates.length) {
    const qDates = new Set(parseDates(quote));
    if (vDates.some((d) => qDates.has(d))) return true;
  }
  const vDur = parseDurationsMonths(value);
  if (vDur.length) {
    const qDur = new Set(parseDurationsMonths(quote));
    if (vDur.some((d) => qDur.has(d))) return true;
  }
  // Names: every significant token of the value appears in the quote.
  const vt = tokens(value).filter((x) => !["the", "and", "of", "pvt", "ltd", "private", "limited", "m/s"].includes(x));
  if (vt.length >= 2) {
    const qt = new Set(tokens(quote));
    if (vt.every((x) => qt.has(x))) return true;
  }
  return false;
}

/** Canonical value used for conflict detection between claims on the same field. */
export function canonicalValue(value: string): string {
  const d = parseDates(value);
  if (d.length === 1) return `date:${d[0]}`;
  const a = parseAmounts(value).filter((n) => n >= 1000);
  if (a.length === 1) return `amount:${a[0]}`;
  const m = parseDurationsMonths(value);
  if (m.length === 1) return `months:${m[0]}`;
  return `text:${tokens(value)
    .filter((x) => !["m/s", "pvt", "ltd", "private", "limited", "the"].includes(x))
    .join(" ")}`;
}
