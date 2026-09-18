/**
 * Deterministic text rendering of structured records (portal JSON), shared by the ingest script
 * and the live-record fetchers so a quote means the same thing wherever the record came from.
 * No server-only import: the ingest script runs outside Next.
 */

/** Flattens a JSON API response into "path: value" lines, 60 lines per page. */
export function jsonPages(data: unknown, opts: { keys?: string[] } = {}): string[] {
  const lines: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (typeof v === "object") return Object.entries(v as Record<string, unknown>).forEach(([k, x]) => walk(x, p ? `${p}.${k}` : k));
    if (opts.keys && !opts.keys.some((k) => p === k || p.endsWith(`.${k}`) || p.startsWith(k))) return;
    let s = String(v).replace(/\s+/g, " ").trim();
    if (s.length > 400) return; // skip encrypted blobs and base64
    // Deterministic annotations so machine formats can be quoted as dates and amounts.
    if (/^\d{13}$/.test(s) && Number(s) > 946684800000 && Number(s) < 4102444800000) {
      const iso = new Date(Number(s)).toISOString();
      s += ` (${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC)`;
    } else if (/^\d+(\.\d+)?E\d+$/i.test(s)) s += ` (= ${Number(s).toFixed(2)})`;
    lines.push(`${p}: ${s}`);
  };
  walk(data, "");
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += 60) pages.push(lines.slice(i, i + 60).join("\n"));
  return pages;
}

/**
 * Removes contact details a public page should not repeat: email addresses, Indian mobile and
 * landline numbers, and PAN numbers. Fetched records are shown publicly on the records page.
 */
export function redactContacts(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\d.])/g, "[phone removed]")
    .replace(/(?<![\d.])0\d{2,4}[\s-]?\d{6,8}(?![\d.])/g, "[phone removed]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN removed]");
}

/** RFC 4180 CSV parsing (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// OMMAS exports carry some HTML entities ("Engineers &amp; Contractors").
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const tidy = (s: string | undefined) => (s ?? "").replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m]).replace(/\s+/g, " ").trim();

/** Rows per page for each OMMAS layout (the importer cites pages by this). */
export const OMMAS_ROWS_PER_PAGE: Record<"slr" | "quality", number> = { slr: 6, quality: 10 };

/**
 * OMMAS (PMGSY) report exports. The report viewer's CSV repeats the report's own column labels in
 * every data row and names the raw fields in a header row; these layouts map each field to the
 * label printed on the report, so a rendered line reads like the report itself.
 */
export const OMMAS_LAYOUTS = {
  slr: [
    [["Textbox2", "Sr.No."], ["MAST_DISTRICT_NAME", "District Name"], ["MAST_DISTRICT_NAME1", "Programme Implementation Unit"], ["MAST_BLOCK_NAME", "Block Name"]],
    [["IMS_PACKAGE_ID1", "Package No."], ["IMS_YEAR", "Sanctioned Year"], ["WORK_TYPE", "Work Type"], ["IMS_UPGRADE_CONNECT", "Connectivity (New / Upgrade)"]],
    [["ROAD_NAME", "Road Name / Bridge Name"]],
    [["HABS", "Name of Benefited Habitations"]],
    [["SANC_AMT", "Sanction Cost"], ["STATE_SHARE", "State Cost"], ["ROAD_LENGTH1", "Road Length (Kms)"], ["BRIDGE_LENGTH", "Bridge Length (Mtrs)"]],
    [["LENGTH_COMPLETED1", "Road Length Completed Till Date"], ["IMS_PAYMENT_MADE1", "Expenditure Till Date"], ["PROPOSAL_STATUS1", "Stage of Progress"], ["MAST_FUNDING_AGENCY_NAME", "Collaboration"]],
    [["CONT_NAME1", "Contractor Name"]],
    [["MAINT_AMT", "5 Years Maintenance Cost Due"], ["COMPLETION_DATE", "Completion Date"]],
  ],
  quality: [
    [["DISTRICT_NAME", "District"], ["BLOCK_NAME", "Block"], ["SANCTION_YEAR", "Sanction Year"], ["IMS_PACKAGE_ID", "Package No."]],
    [["IMS_ROAD_NAME", "Road Name"], ["IMS_PAV_LENGTH", "Road Length"]],
    [["NQM_INSP_COUNT", "NQM* Inspection Count"], ["NQM_GRADE", "NQM* Grade"], ["SQM_INSP_COUNT1", "SQM# Inspection Count"], ["SQM_GRADE", "SQM# Grade"]],
  ],
} as const;
export type OmmasLayout = keyof typeof OMMAS_LAYOUTS;

export interface OmmasRow {
  fields: Record<string, string>;
  /** The rendered lines for this row, exactly as they appear on the page. */
  lines: string[];
}

/** Parses an OMMAS report CSV into its preamble (title, filters, unit note) and data rows. */
export function parseOmmasCsv(text: string, layout: OmmasLayout): { preamble: string; rows: OmmasRow[] } {
  const all = parseCsv(text.replace(/^﻿/, ""));
  const key = layout === "slr" ? "ROAD_NAME" : "IMS_ROAD_NAME";
  const h = all.findIndex((r) => r.includes(key));
  if (h < 0) throw new Error(`Not an OMMAS ${layout} export: no ${key} column`);
  const header = all[h];
  const preamble = tidy(all.slice(0, h).find((r) => r.some((c) => /State\s*:/.test(c)))?.join(" "));
  const id = layout === "slr" ? "IMS_PACKAGE_ID1" : "IMS_PACKAGE_ID";
  const rows = all
    .slice(h + 1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((k, i) => [k, tidy(r[i])])))
    .filter((f) => f[id])
    .map((fields) => ({
      fields,
      lines: OMMAS_LAYOUTS[layout]
        .map((group) =>
          group
            .filter(([k]) => fields[k] !== undefined && fields[k] !== "")
            .map(([k, label]) => `${label}: ${fields[k]}`)
            .join("; "),
        )
        .filter(Boolean),
    }));
  return { preamble, rows };
}

/** Renders an OMMAS export: the preamble (with its unit note) heads every page, then `perPage` rows. */
export function ommasPages(text: string, layout: OmmasLayout, perPage = OMMAS_ROWS_PER_PAGE[layout]): string[] {
  const { preamble, rows } = parseOmmasCsv(text, layout);
  const pages: string[] = [];
  for (let i = 0; i < rows.length; i += perPage) {
    pages.push([preamble, "", ...rows.slice(i, i + perPage).flatMap((r) => [...r.lines, ""])].join("\n").trim());
  }
  return pages.length ? pages : [preamble];
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Place names in a road name and its benefited habitations, for matching reports by name. */
export function placeNames(road: string, habs: string | undefined): string[] {
  const fromRoad = road
    .replace(/^[A-Z]{1,4}\s?\d{1,4}\s*[-–]\s*/, "")
    .split(/\s+(?:to|TO|To)\s+|\s+(?:via|VIA|Via)\.?,?\s+|,|\(|\)|\s+-\s+|\//)
    .map((s) => s.trim());
  const fromHabs = (habs ?? "").split(/\],?\s*/).map((s) => s.replace(/\[.*$/, "").trim());
  const skip = /^(mdr|sh|nh|odr|road|village|colony|main road|taluk border|district border|t\d+|l\d+|mrl\d+)\b/i;
  const out: string[] = [];
  for (const n of [...fromRoad, ...fromHabs]) {
    const clean = n.replace(/\s+/g, " ").replace(/[.\-]+$/, "").trim();
    if (clean.length < 4 || !/[a-z]{3}/i.test(clean) || skip.test(clean) || /^\d/.test(clean)) continue;
    if (!out.some((o) => normName(o) === normName(clean))) out.push(clean);
  }
  return out.slice(0, 14);
}

/**
 * BBMP work orders and payments (from accounts.bbmp.gov.in, compiled by OpenCity). One block per
 * work order with plain labels; the job number and work name, and the bill and payment references,
 * are split where the source file runs them together. Contact numbers are removed by the caller.
 */
export function bbmpWorkOrderPages(text: string, perPage = 12): string[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const col = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => tidy(r[col(name)]);
  const blocks = rows
    .filter((r) => r.length === header.length && get(r, "wodetails"))
    .map((r) => {
      const [job, work] = get(r, "wodetails").split(/<\/a>/i).map((x) => tidy(x.replace(/<[^>]+>/g, "")));
      const [bill, payment] = get(r, "brnumber").split(/(?=CBR\b)/);
      return [
        `Job number: ${job}; Ward: ${get(r, "ward")}`,
        `Work: ${work ?? ""}`,
        `Contractor: ${get(r, "contractor")}`,
        `Bill register: ${tidy(bill)}${payment ? `; Payment: ${tidy(payment)}` : ""}`,
        `Amount: ${get(r, "amount")}; Nett: ${get(r, "nett")}; Deduction: ${get(r, "deduction")}`,
      ].join("\n");
    });
  // Only what the dataset says about itself: the file does not state a currency unit.
  const head = "BBMP work orders and payments, 2025-26 (198-ward regime). Source: accounts.bbmp.gov.in, compiled by OpenCity.";
  const pages: string[] = [];
  for (let i = 0; i < blocks.length; i += perPage) pages.push([head, "", blocks.slice(i, i + perPage).join("\n\n")].join("\n"));
  return pages;
}
