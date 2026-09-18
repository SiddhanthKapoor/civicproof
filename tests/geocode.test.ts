/**
 * On AWS, address search and the road at a report's pin come from Amazon Location Service
 * (Places API). The client talks to a local stand-in that speaks the Places REST API.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ path: req.url ?? "", body });
      const item = {
        PlaceId: "p1",
        PlaceType: "Street",
        Title: "Mullur Main Road",
        Position: [77.71297, 12.894573],
        Address: { Label: "Mullur Main Road, Mullur, Bengaluru 560035, Karnataka, India", Street: "Mullur Main Road", District: "Mullur", Locality: "Bengaluru" },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ResultItems: [item], PricingBucket: "Core" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_GEOCODER", "amazon-location");
  vi.stubEnv("LOCATION_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("geocoding with Amazon Location Service", () => {
  it("finds the road at a pin and searches addresses biased to Bengaluru", async () => {
    const { reverseGeocode, searchAddress } = await import("@/lib/geocode");
    const here = await reverseGeocode(12.894573, 77.71297);
    expect(here).toMatchObject({ road: "Mullur Main Road", locality: "Mullur", provider: "amazon-location" });
    expect(calls[0].path).toContain("reverse-geocode");
    expect(calls[0].body).toMatchObject({ QueryPosition: [77.71297, 12.894573], IntendedUse: "Storage" });

    const found = await searchAddress("Mullur Main Road");
    expect(found[0]).toMatchObject({ lat: 12.894573, lng: 77.71297, label: "Mullur Main Road, Mullur, Bengaluru" });
    expect(calls[1].body).toMatchObject({ QueryText: "Mullur Main Road", Filter: { IncludeCountries: ["IND"] } });
  });
});
