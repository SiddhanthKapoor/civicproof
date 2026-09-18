/**
 * Geocoding for the report form (address search) and the investigator (which road is at the pin).
 *
 *   amazon-location  Amazon Location Service (Places API: Geocode, ReverseGeocode) with the
 *                    function's IAM role. Used on AWS: no third-party service, no usage-policy limits.
 *   nominatim        OpenStreetMap Nominatim, for local runs. Its usage policy allows light use only:
 *                    identifying User-Agent, at most 1 request per second, results cached.
 */
import "server-only";
import { GeocodeCommand, GeoPlacesClient, ReverseGeocodeCommand, type Address } from "@aws-sdk/client-geo-places";
import { config } from "@/lib/config";

export interface Place {
  label: string;
  full?: string;
  lat: number;
  lng: number;
  road?: string;
  locality?: string;
  district?: string;
  provider: "amazon-location" | "nominatim";
}

const BENGALURU: [number, number] = [77.5946, 12.9716]; // [lng, lat]
const cache = new Map<string, { at: number; data: unknown }>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return Promise.resolve(hit.data as T);
  return load().then((data) => {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return data;
  });
}

// ---------------------------------------------------------------- Amazon Location Service

let geo: GeoPlacesClient | undefined;
function places() {
  geo ??= new GeoPlacesClient({
    region: config.region,
    ...(config.locationEndpoint ? { endpoint: config.locationEndpoint, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}),
  });
  return geo;
}

function fromAmazon(title: string | undefined, a: Address | undefined, position: number[] | undefined): Place | undefined {
  if (!position || position.length < 2) return undefined;
  const road = a?.Street;
  const locality = a?.SubDistrict ?? a?.District;
  const parts = [road, locality, a?.Locality].filter(Boolean);
  return {
    label: parts.length ? parts.join(", ") : (title ?? a?.Label ?? ""),
    full: a?.Label ?? title,
    lat: position[1],
    lng: position[0],
    road,
    locality,
    district: a?.District,
    provider: "amazon-location",
  };
}

// ---------------------------------------------------------------- Nominatim

let last = 0;
type NominatimPlace = { display_name: string; lat: string; lon: string; address?: Record<string, string> };

async function nominatim(pathAndQuery: string) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org${pathAndQuery}`, {
    headers: { "user-agent": `CivicProof/0.1 (${config.nominatimContact})`, "accept-language": "en" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function fromNominatim(p: NominatimPlace): Place {
  const a = p.address ?? {};
  const locality = a.neighbourhood ?? a.suburb;
  const parts = [a.road, locality, a.city_district, a.city ?? a.town ?? a.village].filter(Boolean);
  return {
    label: parts.length ? parts.join(", ") : p.display_name.split(",").slice(0, 3).join(","),
    full: p.display_name,
    lat: Number(p.lat),
    lng: Number(p.lon),
    road: a.road,
    locality,
    district: a.city_district,
    provider: "nominatim",
  };
}

// ---------------------------------------------------------------- API

export async function searchAddress(q: string): Promise<Place[]> {
  if (config.geocoder === "none") return [];
  return remember(`s:${config.geocoder}:${q.toLowerCase()}`, async () => {
    if (config.geocoder === "amazon-location") {
      const res = await places().send(
        new GeocodeCommand({ QueryText: q, BiasPosition: BENGALURU, Filter: { IncludeCountries: ["IND"] }, MaxResults: 5, Language: "en", IntendedUse: "Storage" }),
      );
      return (res.ResultItems ?? []).map((r) => fromAmazon(r.Title, r.Address, r.Position)).filter((p): p is Place => Boolean(p));
    }
    const data = (await nominatim(`/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`)) as NominatimPlace[];
    return data.map(fromNominatim);
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<Place | undefined> {
  if (config.geocoder === "none") return undefined;
  return remember(`r:${config.geocoder}:${lat.toFixed(5)},${lng.toFixed(5)}`, async () => {
    if (config.geocoder === "amazon-location") {
      const res = await places().send(new ReverseGeocodeCommand({ QueryPosition: [lng, lat], MaxResults: 1, Language: "en", IntendedUse: "Storage" }));
      const r = res.ResultItems?.[0];
      return r ? fromAmazon(r.Title, r.Address, r.Position ?? [lng, lat]) : undefined;
    }
    const p = (await nominatim(`/reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)) as NominatimPlace;
    return p?.display_name ? fromNominatim(p) : undefined;
  });
}
