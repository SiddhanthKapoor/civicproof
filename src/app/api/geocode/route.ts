/**
 * Address search / reverse geocoding via OpenStreetMap Nominatim, proxied so the browser
 * never calls it directly. Respects the Nominatim usage policy: identifying User-Agent,
 * ≤ 1 request per second per instance, results cached in memory.
 */
import { config } from "@/lib/config";
import { handle, json, problem } from "@/lib/http";

export const runtime = "nodejs";

const cache = new Map<string, { at: number; data: unknown }>();
let last = 0;

async function nominatim(pathAndQuery: string) {
  const hit = cache.get(pathAndQuery);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.data;
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org${pathAndQuery}`, {
    headers: { "user-agent": `CivicProof/0.1 (${config.nominatimContact})`, "accept-language": "en" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  cache.set(pathAndQuery, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return data;
}

type NominatimPlace = { display_name: string; lat: string; lon: string; address?: Record<string, string> };

function shortAddress(p: NominatimPlace) {
  const a = p.address ?? {};
  const parts = [a.road, a.neighbourhood ?? a.suburb, a.city_district, a.city ?? a.town ?? a.village].filter(Boolean);
  return parts.length ? parts.join(", ") : p.display_name.split(",").slice(0, 3).join(",");
}

export const GET = handle("geocode", async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  try {
    if (q) {
      if (q.length < 3 || q.length > 200) return problem(400, "Search for at least 3 characters.");
      const data = (await nominatim(`/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`)) as NominatimPlace[];
      return json({ results: data.map((p) => ({ label: shortAddress(p), full: p.display_name, lat: Number(p.lat), lng: Number(p.lon) })) });
    }
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const p = (await nominatim(`/reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)) as NominatimPlace;
      return json({ label: p.display_name ? shortAddress(p) : undefined, full: p.display_name });
    }
    return problem(400, "Provide q, or lat and lng.");
  } catch {
    return problem(502, "Address lookup is unavailable right now. You can still place the pin on the map.");
  }
});
