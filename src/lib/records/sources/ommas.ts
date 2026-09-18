/**
 * OMMAS (pmgsy.dord.gov.in): the Ministry of Rural Development's public PMGSY reports. The agent
 * searches a district's "SLR: Statewise List of Works" live (PMGSY-I, II and III) by road or village
 * name, and fetches one road's row as a record. No login or captcha; the report viewer is driven the
 * way a browser drives it (layout page for the anti-forgery token, report request, viewer, CSV export).
 *
 * Terms: OMMAS reports carry an NRRDA notice restricting republication. Records are fetched on demand
 * for one case, attributed and linked; exports are cached in memory only.
 */
import { createHash } from "node:crypto";
import { config } from "@/lib/config";
import { normalizeText } from "@/lib/agent/text";
import { parseOmmasCsv, placeNames, type OmmasRow } from "../render";
import type { LiveRecord, RecordHit, RecordSource } from "../types";

const BASE = () => config.ommasBaseUrl ?? "https://pmgsy.dord.gov.in";
const LAYOUT = "/ProposalArea/Proposal/StateListWiseRoadsLayout";
const REPORT = "/ProposalArea/Proposal/StateListWiseRoadsReport/";
const UA = `CivicProof/0.1 (public-records research; ${config.nominatimContact})`;

/** OMMAS district codes for Karnataka (state 17), with today's names as aliases. */
const DISTRICTS: Array<{ name: string; code: number; aliases: string[] }> = [
  { name: "Bangalore U", code: 46, aliases: ["bengaluru urban", "bangalore urban", "bengaluru", "bangalore"] },
  { name: "Bangalore R", code: 45, aliases: ["bengaluru rural", "bangalore rural"] },
  { name: "Ramnagar", code: 456, aliases: ["ramanagara", "ramanagar", "bengaluru south"] },
  { name: "Chickballapur", code: 111, aliases: ["chikkaballapura", "chikkaballapur", "chickballapur"] },
  { name: "Kolar", code: 304, aliases: ["kolar"] },
  { name: "Tumkur", code: 558, aliases: ["tumakuru", "tumkur"] },
  { name: "Mandya", code: 356, aliases: ["mandya"] },
  { name: "Mysore", code: 377, aliases: ["mysuru", "mysore"] },
  { name: "Hassan", code: 217, aliases: ["hassan"] },
  { name: "Chamarajanagar", code: 98, aliases: ["chamarajanagar", "chamarajanagara"] },
  { name: "Chitradurga", code: 113, aliases: ["chitradurga"] },
  { name: "Davanagere", code: 137, aliases: ["davanagere", "davangere"] },
  { name: "Shimoga", code: 498, aliases: ["shivamogga", "shimoga"] },
  { name: "Chickmagalur", code: 112, aliases: ["chikkamagaluru", "chikmagalur"] },
  { name: "Dakshina Kannada", code: 127, aliases: ["dakshina kannada", "mangaluru", "mangalore"] },
  { name: "Udupi", code: 563, aliases: ["udupi"] },
  { name: "Kodagu", code: 300, aliases: ["kodagu", "coorg"] },
  { name: "Uttara Kannada", code: 571, aliases: ["uttara kannada", "karwar"] },
  { name: "Dharwad", code: 149, aliases: ["dharwad", "hubballi", "hubli"] },
  { name: "Belgaum", code: 63, aliases: ["belagavi", "belgaum"] },
  { name: "Bagalkot", code: 35, aliases: ["bagalkote", "bagalkot"] },
  { name: "Bijapur", code: 78, aliases: ["vijayapura", "bijapur"] },
  { name: "Gulbarga", code: 203, aliases: ["kalaburagi", "gulbarga"] },
  { name: "Bidar", code: 77, aliases: ["bidar"] },
  { name: "Raichur", code: 445, aliases: ["raichur"] },
  { name: "Koppal", code: 308, aliases: ["koppal"] },
  { name: "Yadgir", code: 598, aliases: ["yadgir", "yadagiri"] },
  { name: "Bellary", code: 64, aliases: ["ballari", "bellary"] },
  { name: "Vijayanagar", code: 772, aliases: ["vijayanagara", "hosapete"] },
  { name: "Gadag", code: 186, aliases: ["gadag"] },
  { name: "Haveri", code: 219, aliases: ["haveri"] },
];
const SCHEMES = [
  { code: 1, label: "PMGSY-I" },
  { code: 2, label: "PMGSY-II" },
  { code: 4, label: "PMGSY-III" },
];

// Longest alias first, so "bengaluru rural" wins over "bengaluru".
const ALIASES = DISTRICTS.flatMap((d) => d.aliases.map((a) => ({ a, d }))).sort((x, y) => y.a.length - x.a.length);

/** The OMMAS district a place name refers to, if any. */
export function ommasDistrict(text: string | undefined) {
  if (!text) return undefined;
  const t = ` ${normalizeText(text)} `;
  return ALIASES.find(({ a }) => t.includes(` ${a} `))?.d;
}

/** Words that appear in most road names and say nothing about which road. */
const GENERIC = new Set(["road", "roads", "main", "cross", "street", "near", "colony", "village", "layout", "junction", "via", "the", "and", "block", "taluk", "district", "pmgsy", "rural", "urban"]);

// ---------------------------------------------------------------- report viewer

class Session {
  private cookies = new Map<string, string>();

  private remember(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }

  async request(pathOrUrl: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<string> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE()}${pathOrUrl}`;
    const res = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": UA,
        referer: `${BASE()}/`,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
    this.remember(res);
    if (!res.ok) throw new Error(`OMMAS answered ${res.status} for ${new URL(url).pathname}`);
    return res.text();
  }
}

export interface OmmasExport {
  district: string;
  scheme: string;
  csv: string;
  sha256: string;
  retrievedAt: string;
  rows: OmmasRow[];
  preamble: string;
}

async function exportRoadList(districtCode: number, districtName: string, schemeCode: number): Promise<string> {
  const s = new Session();
  const layout = await s.request(LAYOUT);
  const token = /name="__RequestVerificationToken" type="hidden" value="([^"]+)"/.exec(layout)?.[1] ?? "";
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    Mast_State_Code: "0",
    Mast_District_Code: "0",
    Mast_Block_Code: "0",
    StateName: "Karnataka",
    DistName: districtName,
    BlockName: "All Blocks",
    BatchName: "All Batch",
    CollaborationName: "All Collaborations",
    StatusName: "All Status",
    LevelCode: "1",
    LoanName: "Not Available",
    localizedValue: "en",
    StateCode: "17",
    DistrictCode: String(districtCode),
    BlockCode: "0",
    Year: "0",
    Batch: "0",
    FundingAgency: "0",
    Status: "%",
    Scheme: String(schemeCode),
    SubScheme: "0",
    LoanCode: "0",
    RoadWise: "true",
  });
  const report = await s.request(REPORT, {
    method: "POST",
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
  });
  const viewer = /src="(\/MvcReportViewer\.aspx[^"]+)"/.exec(report)?.[1]?.replace(/&amp;/g, "&");
  if (!viewer) throw new Error("OMMAS did not return a report viewer");
  const page = await s.request(viewer, {}, 120_000);
  const base = /ExportUrlBase":"([^"]+)/.exec(page)?.[1]?.replace(/\\u0026/g, "&");
  if (!base) throw new Error("OMMAS report viewer offered no export");
  return s.request(base + "CSV", {}, 180_000);
}

const cache = new Map<string, { at: number; value: Promise<OmmasExport> }>();

/** One district's road list for one scheme, cached in memory for an hour. */
export function roadList(district: { name: string; code: number }, scheme: { code: number; label: string }): Promise<OmmasExport> {
  const key = `${district.code}:${scheme.code}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.value;
  const value = exportRoadList(district.code, district.name, scheme.code).then((csv) => {
    const { preamble, rows } = parseOmmasCsv(csv, "slr");
    return { district: district.name, scheme: scheme.label, csv, sha256: createHash("sha256").update(csv).digest("hex"), retrievedAt: new Date().toISOString(), rows, preamble };
  });
  value.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------- source

const idFor = (districtCode: number, schemeCode: number, row: OmmasRow) =>
  `ommas-${districtCode}-${schemeCode}-${row.fields.IMS_PACKAGE_ID1.toLowerCase().replace(/[^a-z0-9]/g, "")}-${createHash("sha1").update(row.fields.ROAD_NAME).digest("hex").slice(0, 6)}`;

function matchScore(row: OmmasRow, terms: string[]): number {
  const hay = normalizeText(`${row.fields.ROAD_NAME} ${row.fields.HABS ?? ""} ${row.fields.MAST_BLOCK_NAME}`);
  return terms.filter((t) => hay.includes(t)).length / terms.length;
}

export const ommas: RecordSource = {
  id: "ommas",
  label: "OMMAS (PMGSY road lists)",
  covers: "PMGSY rural roads in any Karnataka district, schemes I–III: package, contractor, costs, stage, completion; searched in the report's district, or a district named in the query",

  async search(text, limit, hint) {
    const district = ommasDistrict(text) ?? ommasDistrict(hint?.district) ?? ommasDistrict(hint?.locality);
    if (!district) throw new Error("Name the district (for example “Kolar”) or search from a report whose location is known.");
    const terms = normalizeText(text)
      .split(" ")
      .filter((t) => t.length >= 3 && !GENERIC.has(t) && !district.aliases.some((a) => a.split(" ").includes(t)));
    if (!terms.length) throw new Error("Add a road, village or block name to the query.");
    const exports = await Promise.all(SCHEMES.map((s) => roadList(district, s).then((e) => ({ s, e }))));
    return exports
      .flatMap(({ s, e }) => e.rows.map((row) => ({ s, row, score: matchScore(row, terms) })))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(
        ({ s, row }): RecordHit => ({
          id: idFor(district.code, s.code, row),
          source: "ommas",
          title: row.fields.ROAD_NAME,
          reference: row.fields.IMS_PACKAGE_ID1,
          department: row.fields.MAST_DISTRICT_NAME1,
          location: `${row.fields.MAST_BLOCK_NAME} block, ${district.name}`,
          date: row.fields.IMS_YEAR,
          status: row.fields.PROPOSAL_STATUS1,
          value: row.fields.SANC_AMT ? `${row.fields.SANC_AMT} lakh (sanction cost)` : undefined,
        }),
      );
  },

  async fetch(id) {
    const m = /^ommas-(\d+)-(\d+)-/.exec(id);
    const district = DISTRICTS.find((d) => d.code === Number(m?.[1]));
    const scheme = SCHEMES.find((s) => s.code === Number(m?.[2]));
    if (!district || !scheme) throw new Error(`Not an OMMAS record id: ${id}`);
    const e = await roadList(district, scheme);
    const row = e.rows.find((r) => idFor(district.code, scheme.code, r) === id);
    if (!row) throw new Error("The road is no longer in the OMMAS list.");
    return {
      id,
      source: "ommas",
      title: row.fields.ROAD_NAME,
      publisher: "NRIDA, Ministry of Rural Development (OMMAS citizen reports)",
      sourceType: "official_web",
      url: `${BASE()}${LAYOUT}`,
      retrievedAt: e.retrievedAt,
      sha256: e.sha256,
      pages: [[e.preamble, "", ...row.lines].join("\n")],
      reference: row.fields.IMS_PACKAGE_ID1,
      department: row.fields.MAST_DISTRICT_NAME1,
      location: `${row.fields.MAST_BLOCK_NAME} block, ${district.name}`,
      roadNames: placeNames(row.fields.ROAD_NAME, row.fields.HABS),
      notes: `One row of the OMMAS “SLR: Statewise List of Works” report (${district.name}, ${scheme.label}), exported as CSV; the SHA-256 is of the whole export. OMMAS reports carry an NRRDA notice restricting republication.`,
    } satisfies LiveRecord;
  },
};
