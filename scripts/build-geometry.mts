/**
 * Builds corpus/geometry/projects.geojson — one geometry per project — from:
 *   - GeoSadak PRCD 2022 road lines (official PMGSY GIS, GODL-India), keyed by OMMAS package no.
 *   - OpenStreetMap ways fetched with the Overpass queries in corpus/geometry/raw/*.overpassql
 *     (© OpenStreetMap contributors, ODbL). Used only where no official geometry is published;
 *     these are traced by road name and labelled as approximate in the app.
 *
 * Run: npx tsx scripts/build-geometry.mts
 */
import { readFileSync, writeFileSync } from "node:fs";

type Coord = [number, number];
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "MultiLineString"; coordinates: Coord[][] } };

const round = (c: Coord): Coord => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];

// --- PMGSY: GeoSadak ---------------------------------------------------------
const geosadak = JSON.parse(readFileSync("corpus/geometry/geosadak-pmgsy3-bengaluru-urban.geojson", "utf8"));
const byPackage = new Map<string, Coord[][]>();
for (const f of geosadak.features) {
  const pkg = f.properties.ommas_package_no as string;
  const lines: Coord[][] = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const cleaned = lines.map((l) => l.map(round)).filter((l) => l.length >= 2);
  byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), ...cleaned]);
}

// --- City roads: OpenStreetMap -----------------------------------------------
const osm = [
  ...JSON.parse(readFileSync("corpus/geometry/raw/overpass-central-bengaluru-roads.json", "utf8")).elements,
  ...JSON.parse(readFileSync("corpus/geometry/raw/overpass-rrm-road.json", "utf8")).elements,
] as Array<{ id: number; tags: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }>;

function osmLines(name: string, keep?: (c: Coord) => boolean): { lines: Coord[][]; ways: number[] } {
  const lines: Coord[][] = [];
  const ways: number[] = [];
  for (const e of osm) {
    if (e.tags.name !== name || !e.geometry) continue;
    let pts = e.geometry.map((p) => round([p.lon, p.lat]));
    if (keep) pts = pts.filter(keep);
    if (pts.length >= 2) {
      lines.push(pts);
      ways.push(e.id);
    }
  }
  if (!lines.length) throw new Error(`No OSM geometry for ${name}`);
  return { lines, ways };
}

function combine(parts: Array<{ lines: Coord[][]; ways: number[] }>) {
  return { lines: parts.flatMap((p) => p.lines), ways: parts.flatMap((p) => p.ways) };
}

const features: Feature[] = [];
const PMGSY = ["KN03-62", "KN03-63", "KN03-65", "KN03-67", "KN03-69", "KN03-70"];
for (const pkg of PMGSY) {
  const lines = byPackage.get(pkg);
  if (!lines) throw new Error(`No GeoSadak geometry for ${pkg}`);
  features.push({ type: "Feature", properties: { project: `pmgsy-${pkg.toLowerCase()}`, source: "GeoSadak PRCD 2022 (GODL-India)" }, geometry: { type: "MultiLineString", coordinates: lines } });
}

const wt = combine([
  osmLines("Mahatma Gandhi Road", (c) => c[0] <= 77.6200),
  osmLines("Residency Road"),
  osmLines("Lower Agaram Road"),
  osmLines("Old Post Office Road"),
  osmLines("Thimmaiah Road"),
  osmLines("Narayan Pillai Street"),
]);
features.push({ type: "Feature", properties: { project: "bbmp-whitetopping-2023-24-pkg2", source: "OpenStreetMap (ODbL)", osmWays: wt.ways }, geometry: { type: "MultiLineString", coordinates: wt.lines } });

const ts = combine([
  osmLines("Lavelle Road"),
  osmLines("Brigade Road", (c) => c[1] >= 12.9720),
  osmLines("Rajaram Mohan Roy Road"),
]);
features.push({ type: "Feature", properties: { project: "bscl-tender-sure-phase-a-pkg7", source: "OpenStreetMap (ODbL)", osmWays: ts.ways }, geometry: { type: "MultiLineString", coordinates: ts.lines } });

writeFileSync("corpus/geometry/projects.geojson", JSON.stringify({ type: "FeatureCollection", features }));
for (const f of features) console.log(f.properties.project, f.geometry.coordinates.length, "lines", f.geometry.coordinates.flat().length, "points");
