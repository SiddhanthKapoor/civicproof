/**
 * Address search and reverse geocoding for the report form, proxied so the browser never calls a
 * geocoder directly: Amazon Location Service on AWS, OpenStreetMap Nominatim locally (lib/geocode.ts).
 */
import { reverseGeocode, searchAddress } from "@/lib/geocode";
import { handle, json, problem } from "@/lib/http";
import { log } from "@/lib/log";

export const runtime = "nodejs";

export const GET = handle("geocode", async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  try {
    if (q) {
      if (q.length < 3 || q.length > 200) return problem(400, "Search for at least 3 characters.");
      const results = await searchAddress(q);
      return json({ results: results.map((p) => ({ label: p.label, full: p.full, lat: p.lat, lng: p.lng })) });
    }
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const p = await reverseGeocode(lat, lng);
      return json({ label: p?.label, full: p?.full });
    }
    return problem(400, "Provide q, or lat and lng.");
  } catch (e) {
    log.warn("geocode.failed", { error: e instanceof Error ? e.message : String(e) });
    return problem(502, "Address lookup is unavailable right now. You can still place the pin on the map.");
  }
});
