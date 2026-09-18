import type { LatLng } from "@/lib/schemas";

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from p to segment ab, using a local equirectangular projection (fine at city scale). */
function pointSegment(p: LatLng, a: [number, number], b: [number, number]): number {
  const k = Math.cos(rad(p.lat));
  const ax = (a[0] - p.lng) * k, ay = a[1] - p.lat;
  const bx = (b[0] - p.lng) * k, by = b[1] - p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy) * (Math.PI / 180) * R;
}

export function distanceToGeometry(p: LatLng, g: Geometry): number {
  if (g.type === "Point") return haversine(p, { lng: g.coordinates[0], lat: g.coordinates[1] });
  const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
  let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) best = Math.min(best, haversine(p, { lng: line[0][0], lat: line[0][1] }));
    for (let i = 0; i < line.length - 1; i++) best = Math.min(best, pointSegment(p, line[i], line[i + 1]));
  }
  return best;
}

export function geometryCenter(g: Geometry): LatLng {
  const pts = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates.flat();
  const lng = pts.reduce((s, c) => s + c[0], 0) / pts.length;
  const lat = pts.reduce((s, c) => s + c[1], 0) / pts.length;
  return { lat, lng };
}

export function geometryLengthM(g: Geometry): number {
  if (g.type === "Point") return 0;
  const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
  let total = 0;
  for (const line of lines)
    for (let i = 0; i < line.length - 1; i++)
      total += haversine({ lng: line[i][0], lat: line[i][1] }, { lng: line[i + 1][0], lat: line[i + 1][1] });
  return total;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
