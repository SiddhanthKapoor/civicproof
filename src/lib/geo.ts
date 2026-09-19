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

// ---------------------------------------------------------------------------
// Device location
// ---------------------------------------------------------------------------

/**
 * A fix this coarse cannot tell one road from the next, so it is shown as a warning and recorded
 * on the case rather than being presented as if it were a precise reading. The default search
 * radius for nearby projects is 750 m; a fix worse than 100 m is already a large share of that.
 */
export const COARSE_FIX_M = 100;

/** How precise the device said the fix was, in the product's own plain register. */
export function describeAccuracy(accuracyM: number | undefined): string | undefined {
  if (accuracyM === undefined || !Number.isFinite(accuracyM) || accuracyM <= 0) return undefined;
  return accuracyM < 1000 ? `±${Math.round(accuracyM)} m` : `±${(accuracyM / 1000).toFixed(1)} km`;
}

/**
 * What actually went wrong, rather than assuming the reporter refused. The browser distinguishes
 * a refusal from a device that has no fix and from one that ran out of time, and each needs a
 * different thing from the user.
 */
export function geolocationErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1: // PERMISSION_DENIED
      return "Location permission was declined. Allow it in your browser's site settings, or place the pin on the map instead.";
    case 2: // POSITION_UNAVAILABLE
      return "Your device could not get a location fix. Check that location services are on, or place the pin on the map instead.";
    case 3: // TIMEOUT
      return "Getting a location took too long — this is common indoors. Try again outdoors, or place the pin on the map instead.";
    default:
      return "Your device did not return a location. Place the pin on the map instead.";
  }
}

/** GeolocationPositionError.PERMISSION_DENIED. A refusal is final; the other codes are worth a retry. */
export const PERMISSION_DENIED = 1;

export interface DeviceFix {
  lat: number;
  lng: number;
  /** The device's own accuracy estimate in metres, when it gave one. */
  accuracyM?: number;
}

export class GeolocationFailure extends Error {
  constructor(readonly code: number | undefined) {
    super(geolocationErrorMessage(code));
    this.name = "GeolocationFailure";
  }
}

/**
 * Asks the device for a precise fix, and falls back to the quicker network fix when that times out
 * or the device has none — a cold satellite fix routinely needs longer than ten seconds, and
 * indoors it may never arrive. A refusal is final and is never retried, because retrying only
 * re-prompts someone who has already said no.
 *
 * Split out from the form so the staged behaviour can be tested without a browser.
 */
export function getDeviceLocation(geo: Pick<Geolocation, "getCurrentPosition">): Promise<DeviceFix> {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const toFix = (pos: GeolocationPosition): DeviceFix => ({
    lat: round(pos.coords.latitude),
    lng: round(pos.coords.longitude),
    ...(Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy > 0 ? { accuracyM: pos.coords.accuracy } : {}),
  });
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (pos) => resolve(toFix(pos)),
      (precise) => {
        if (precise.code === PERMISSION_DENIED) return reject(new GeolocationFailure(precise.code));
        geo.getCurrentPosition(
          (pos) => resolve(toFix(pos)),
          (coarse) => reject(new GeolocationFailure(coarse.code)),
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
