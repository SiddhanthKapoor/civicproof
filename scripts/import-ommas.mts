/**
 * Imports PMGSY road works for the districts around Bengaluru from OMMAS exports:
 *   node --import tsx scripts/import-ommas.mts <folder with the OMMAS CSV exports and the GeoSadak match>
 *
 * For each district and scheme (PMGSY-I, II, III) it adds the official road list (CSV export of the
 * OMMAS "SLR: Statewise List of Works" report) to the corpus, and one project per work, with:
 *   - reference facts quoted from the rendered report rows (package, road, agency, contractor,
 *     sanction cost, length, stage, maintenance cost, physical completion date, quality grade),
 *     each run through the app's own verifier; any that fail are dropped and reported;
 *   - official geometry where GeoSadak (PMGSY GIS, GODL-India) has the road (PMGSY-III, matched by
 *     district, block, year and road name); otherwise no geometry, and the project is found by name.
 * Re-running replaces what an earlier run imported. Run `npm run ingest` afterwards.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { OMMAS_ROWS_PER_PAGE, ommasPages, parseOmmasCsv, placeNames, type OmmasRow } from "../src/lib/records/render";
import { verifyClaim, type CorpusReader } from "../src/lib/agent/verifier";
import type { ClaimField } from "../src/lib/schemas";

const SRC = process.argv[2];
if (!SRC) throw new Error("Pass the folder that holds the OMMAS exports.");
const ROOT = "corpus";
const RETRIEVED = "2026-09-19";
const LAYOUT_URL = "https://pmgsy.dord.gov.in/ProposalArea/Proposal/StateListWiseRoadsLayout";
const QG_URL = "https://pmgsy.dord.gov.in/QualityMonitoringArea/QualityMonitoring/QMMonWorksDetailLayout";
const OMMAS_LICENCE =
  "© NRRDA (report footer). OMMAS's legal notice restricts republication without NRIDA's written permission; included here only to verify the quoted records, with attribution and links.";
const UNIT_NOTE = "Note : All Costs are in Lakhs and All Lengths are in Kms.";
const GUIDELINE_QUOTE =
  "All PMGSY roads (including associated Main Rural Links / Through Routes of PMGSY link routes) will be covered by 5-year maintenance contracts, (see Para 8.6) to be entered into along with the construction contract, with the same contractor, as per the Standard Bidding Document.";

const DISTRICTS = [
  { ommas: "BangaloreR", slug: "bengaluru-rural", label: "Bengaluru Rural", district: "Bangalore R", dir: "" },
  { ommas: "Ramanagara", slug: "ramanagara", label: "Ramanagara (Bengaluru South)", district: "Ramanagara", dir: "ommas_other_districts" },
  { ommas: "Chikkaballapura", slug: "chikkaballapura", label: "Chikkaballapura", district: "Chikkaballapura", dir: "ommas_other_districts" },
  { ommas: "Kolar", slug: "kolar", label: "Kolar", district: "Kolar", dir: "ommas_other_districts" },
  { ommas: "Tumakuru", slug: "tumakuru", label: "Tumakuru", district: "Tumakuru", dir: "ommas_other_districts" },
];
const SCHEMES = [
  { file: "PMGSY-I", id: "pmgsy1", label: "PMGSY-I" },
  { file: "PMGSY-II", id: "pmgsy2", label: "PMGSY-II" },
  { file: "PMGSY-III", id: "pmgsy3", label: "PMGSY-III" },
];

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const readJson = (f: string) => JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const round = (c: number[]) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];

// ---------------------------------------------------------------- existing corpus

const manifest = readJson("manifest.json");
const projects: Array<Record<string, unknown> & { id: string }> = readJson("projects.json");
const authorities: Array<Record<string, unknown> & { id: string }> = readJson("authorities.json");
let extraction: Record<string, unknown> = {};
try {
  extraction = readJson("extraction.json");
} catch {
  /* first run */
}
const pagesFile = readJson("generated/pages.json") as Record<string, { pages: string[] }>;

const imported = (id: string) => DISTRICTS.some((d) => id.startsWith(`pmgsy-${d.slug}-`) || id.endsWith(`-${d.slug}`) || id === `pmgsy-dpiu-${d.slug}`);
manifest.documents = manifest.documents.filter((d: { id: string }) => !imported(d.id));
const keptProjects = projects.filter((p) => !imported(p.id));
const keptAuthorities = authorities.filter((a) => !imported(a.id));
for (const k of Object.keys(extraction)) if (imported(k)) delete extraction[k];

const urbanDpiu = authorities.find((a) => a.id === "pmgsy-dpiu-bengaluru-urban") as unknown as Record<string, unknown> & { rti: Record<string, unknown> };
type GeoFeature = {
  geometry: { type: "LineString"; coordinates: number[][] } | { type: "MultiLineString"; coordinates: number[][][] };
  properties: { district: string; ommas_package_no: string; ommas_road_name: string; match_confidence: string };
};
const geosadak: { features: GeoFeature[] } = JSON.parse(readFileSync(path.join(SRC, "geosadak", "GeoSadak_PMGSY-III_matched_5districts.geojson"), "utf8"));

type Json = Record<string, unknown>;
const newDocs: Json[] = [];
const newProjects: Array<Json & { geometry?: unknown; reference: unknown[] }> = [];
const newAuthorities: Json[] = [];
const docPages = new Map<string, string[]>();
let dropped = 0;
const droppedBy = new Map<string, string[]>();

for (const d of DISTRICTS) {
  const authorityId = `pmgsy-dpiu-${d.slug}`;
  let piuName: string | undefined;

  // Quality grades (all schemes), where exported.
  const qgFile = `OMMAS_QualityGrading_NQM-SQM_Karnataka_${d.ommas}_Jan2016-Sep2026.csv`;
  let qg: { id: string; rows: OmmasRow[]; perPage: number } | undefined;
  try {
    const buf = readFileSync(path.join(SRC, d.dir, qgFile));
    const id = `ommas-quality-grading-${d.slug}`;
    const file = `${id}.csv`;
    copyFileSync(path.join(SRC, d.dir, qgFile), path.join(ROOT, "documents", file));
    newDocs.push({
      id,
      title: `Works Wise Grading Abstract — NQM/SQM inspections, ${d.district}, Jan 2016 to Sep 2026 (CSV export)`,
      publisher: "NRIDA, Ministry of Rural Development (OMMAS citizen reports)",
      sourceType: "official_web",
      url: QG_URL,
      retrievedAt: RETRIEVED,
      file,
      licence: OMMAS_LICENCE,
      notes: `Exported as CSV from the OMMAS quality-monitoring report viewer on ${RETRIEVED}. Rendered row by row with the report's own column labels.`,
      sha256: sha256(buf),
    });
    extraction[id] = { ommas: "quality" };
    docPages.set(id, ommasPages(buf.toString("utf8"), "quality"));
    qg = { id, rows: parseOmmasCsv(buf.toString("utf8"), "quality").rows, perPage: OMMAS_ROWS_PER_PAGE.quality };
  } catch {
    /* no quality export for this district */
  }

  for (const s of SCHEMES) {
    const srcFile = path.join(SRC, d.dir, `OMMAS_SLR_${s.file}_Karnataka_${d.ommas}.csv`);
    let buf: Buffer;
    try {
      buf = readFileSync(srcFile);
    } catch {
      continue;
    }
    const docId = `ommas-slr-${s.id}-${d.slug}`;
    const file = `${docId}.csv`;
    copyFileSync(srcFile, path.join(ROOT, "documents", file));
    const { rows } = parseOmmasCsv(buf.toString("utf8"), "slr");
    if (!rows.length) continue;
    newDocs.push({
      id: docId,
      title: `SLR: Statewise List of Works — Karnataka, ${d.district}, ${s.label} (CSV export)`,
      publisher: "NRIDA, Ministry of Rural Development (OMMAS citizen reports)",
      sourceType: "official_web",
      url: LAYOUT_URL,
      retrievedAt: RETRIEVED,
      file,
      licence: OMMAS_LICENCE,
      notes: `Exported as CSV from the OMMAS citizen report viewer on ${RETRIEVED} (district ${d.district}, all blocks, all years, ${s.label}). Rendered row by row with the report's own column labels. Costs in ₹ lakh, lengths in km.`,
      sha256: sha256(buf),
    });
    extraction[docId] = { ommas: "slr" };
    const pages = ommasPages(buf.toString("utf8"), "slr");
    docPages.set(docId, pages);

    const perPackage = new Map<string, number>();
    rows.forEach((row, i) => {
      const f = row.fields;
      const page = Math.floor(i / OMMAS_ROWS_PER_PAGE.slr) + 1;
      piuName ??= f.MAST_DISTRICT_NAME1;
      const pkg = f.IMS_PACKAGE_ID1;
      const n = (perPackage.get(pkg) ?? 0) + 1;
      perPackage.set(pkg, n);
      const id = `pmgsy-${d.slug}-${pkg.toLowerCase()}${n > 1 ? `-${n}` : ""}`;
      const line = (label: string) => row.lines.find((l) => l.startsWith(`${label}: `) || l.includes(`; ${label}: `));
      const segment = (label: string) => line(label)?.split("; ").find((x) => x.startsWith(`${label}: `));
      const cite = (quote: string | undefined) => (quote ? [{ docId, page, quote }] : []);
      const ref = (field: string, text: string, value: string | undefined, citations: Array<{ docId: string; page: number; quote: string }>, notes?: string) =>
        value && citations.length ? [{ field, text, value, citations, ...(notes ? { notes } : {}) }] : [];

      const contractor = f.CONT_NAME1 && !/^(-+|na|n\/a)$/i.test(f.CONT_NAME1) ? f.CONT_NAME1.replace(/\s*\[[^\]]*\]\s*$/, "").trim() : undefined;
      const physical = /Physical:\s*(\d{2}-\d{2}-\d{4})/.exec(f.COMPLETION_DATE ?? "")?.[1];
      const num = (v: string | undefined) => (v && Number(v) > 0 ? v : undefined);
      const isBridge = f.WORK_TYPE !== "ROAD";

      const qgRow = qg?.rows.findIndex((q) => q.fields.IMS_PACKAGE_ID === pkg && norm(q.fields.IMS_ROAD_NAME).slice(0, 25) === norm(f.ROAD_NAME).slice(0, 25));
      const grade = qg && qgRow !== undefined && qgRow >= 0 ? qg.rows[qgRow] : undefined;
      const gradeValue = grade ? [grade.fields.SQM_GRADE, grade.fields.NQM_GRADE].find((g) => g && g !== "--") : undefined;

      const reference = [
        ...ref("project_name", `OMMAS lists ${s.label} work ${pkg} as “${f.ROAD_NAME}”.`, f.ROAD_NAME, cite(segment("Road Name / Bridge Name"))),
        ...ref("project_id", `OMMAS package number ${pkg}.`, pkg, cite(segment("Package No."))),
        ...ref("agency", `The programme implementation unit is recorded as “${f.MAST_DISTRICT_NAME1}”.`, f.MAST_DISTRICT_NAME1, cite(segment("Programme Implementation Unit"))),
        ...ref("contractor", `OMMAS lists the contractor for this work as “${contractor}”.`, contractor, cite(segment("Contractor Name"))),
        ...ref("sanctioned_cost", `The sanction cost is recorded as ${f.SANC_AMT} (₹ lakh).`, num(f.SANC_AMT) && `₹${f.SANC_AMT} lakh`, [...cite(segment("Sanction Cost")), ...cite(UNIT_NOTE)]),
        ...(isBridge
          ? []
          : ref("scope", `Road length ${f.ROAD_LENGTH1} km; ${f.LENGTH_COMPLETED1 || "no length"} km recorded as completed.`, num(f.ROAD_LENGTH1) && `${f.ROAD_LENGTH1} km`, [...cite(segment("Road Length (Kms)")), ...cite(UNIT_NOTE)])),
        ...ref("work_status", `OMMAS records the stage of progress as “${f.PROPOSAL_STATUS1}”.`, f.PROPOSAL_STATUS1, cite(segment("Stage of Progress"))),
        ...ref("maintenance_cost", `The “5 Years Maintenance Cost Due” column shows ${f.MAINT_AMT} (₹ lakh).`, num(f.MAINT_AMT) && `₹${f.MAINT_AMT} lakh`, [...cite(segment("5 Years Maintenance Cost Due")), ...cite(UNIT_NOTE)]),
        ...ref("completion_date", `The completion date column reads “${f.COMPLETION_DATE}”; the physical completion date is ${physical}.`, physical, cite(segment("Completion Date"))),
        ...ref("defect_liability", "The PMGSY Programme Guidelines (para 17.2) state that all PMGSY roads are covered by 5-year maintenance contracts entered into with the same contractor as the construction contract.", "5 years", [{ docId: "pmgsy-programme-guidelines", page: 40, quote: GUIDELINE_QUOTE }], "Programme-wide rule in the PMGSY Programme Guidelines; the specific contract for this road was not available to confirm its terms."),
        ...(grade && gradeValue && qg
          ? ref(
              "quality_grade",
              `Quality monitoring, Jan 2016 to Sep 2026: ${grade.fields.NQM_INSP_COUNT} National and ${grade.fields.SQM_INSP_COUNT1} State Quality Monitor inspection(s); grade recorded “${gradeValue}”.`,
              gradeValue,
              grade.lines.slice(1, 3).map((quote) => ({ docId: qg!.id, page: Math.floor(qgRow! / qg!.perPage) + 1, quote })),
            )
          : []),
      ];

      // Keep only facts the app's own verifier accepts against the rendered pages.
      const reader: CorpusReader = {
        getDocument: (id) => ({ id, title: id, publisher: "", sourceType: "official_web", retrievedAt: RETRIEVED }),
        getPage: (id, p) => (docPages.get(id) ?? pagesFile[id]?.pages)?.[p - 1],
        pageCount: (id) => (docPages.get(id) ?? pagesFile[id]?.pages)?.length ?? 0,
      };
      const verified = reference.filter((r) => {
        const v = verifyClaim(
          { field: r.field as ClaimField, text: r.text, value: r.value, origin: "official_record", citations: r.citations.map((c) => ({ docId: c.docId, page: c.page, quote: c.quote })) },
          reader,
          RETRIEVED,
        );
        if (v.claim.verification !== "verified") {
          dropped++;
          droppedBy.set(r.field, [...(droppedBy.get(r.field) ?? []), `${id}: ${r.value} (${v.claim.verification}; ${v.rejections.join(" ") || v.claim.notes || ""})`]);
        }
        return v.claim.verification === "verified";
      });

      const g = geosadak.features.find(
        (x) =>
          x.properties.district === d.district &&
          x.properties.ommas_package_no === pkg &&
          norm(x.properties.ommas_road_name) === norm(f.ROAD_NAME) &&
          ["high", "medium"].includes(x.properties.match_confidence),
      );
      const geometry = g
        ? g.geometry.type === "LineString"
          ? { type: "LineString", coordinates: g.geometry.coordinates.map(round) }
          : { type: "MultiLineString", coordinates: g.geometry.coordinates.map((l) => l.map(round)) }
        : undefined;

      newProjects.push({
        id,
        name: f.ROAD_NAME,
        roadNames: placeNames(f.ROAD_NAME, f.HABS),
        locality: `${f.MAST_BLOCK_NAME} block, ${d.label} district`,
        city: d.label,
        state: "Karnataka",
        agencyId: authorityId,
        categories: ["road_damage", "pothole", "drainage"],
        ...(geometry ? { geometry } : {}),
        geometrySource: geometry
          ? {
              kind: "official",
              note: `Road alignment from GeoSadak (PMGSY GIS, PRCD 2022 proposals, GODL-India), matched to OMMAS by district, block, year and road name (${g?.properties.match_confidence} confidence).`,
              url: "https://github.com/datameet/pmgsy-geosadak",
            }
          : {
              kind: "none",
              note: `No official map geometry is published for this ${s.label} road; it is found by the place names in its OMMAS record.`,
            },
        documents: [docId, ...(qg ? [qg.id] : []), "pmgsy-programme-guidelines"],
        reference: verified,
        summary: `${s.label} · package ${pkg} · ${f.MAST_BLOCK_NAME} block · ${f.PROPOSAL_STATUS1 || "stage not recorded"}`,
      });
    });
  }

  newAuthorities.push({
    ...urbanDpiu,
    id: authorityId,
    name: `District Programme Implementation Unit (PMGSY), ${d.label}`,
    shortName: `PMGSY DPIU ${d.label}`,
    jurisdiction: `PMGSY rural roads in ${d.label} district${piuName ? ` (recorded in OMMAS as “${piuName}”)` : ""}`,
    officer: `The Executive Engineer, District Programme Implementation Unit (PMGSY), ${d.label}`,
    rti: { ...urbanDpiu.rti, addressee: `The Public Information Officer, District Programme Implementation Unit (PMGSY), ${d.label}` },
  });
}

manifest.documents.push(...newDocs);
manifest.description =
  "CivicProof source corpus: public records for road works in and around Bengaluru, retrieved 18–19 Sep 2026. Every file is checked against its SHA-256 at ingest.";
writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
writeFileSync(path.join(ROOT, "projects.json"), JSON.stringify([...keptProjects, ...newProjects], null, 1) + "\n");
writeFileSync(path.join(ROOT, "authorities.json"), JSON.stringify([...keptAuthorities, ...newAuthorities], null, 1) + "\n");
writeFileSync(path.join(ROOT, "extraction.json"), JSON.stringify(extraction, null, 1) + "\n");

const withGeometry = newProjects.filter((p) => p.geometry).length;
const facts = newProjects.reduce((n, p) => n + p.reference.length, 0);
console.log(`${newDocs.length} documents, ${newProjects.length} projects (${withGeometry} with official geometry), ${facts} reference facts, ${newAuthorities.length} authorities.`);
console.log(`${dropped} generated facts dropped because the verifier did not accept them.`);
for (const [field, list] of droppedBy) console.log(`  ${field}: ${list.length}, e.g. ${list.slice(0, 2).join(" | ")}`);
