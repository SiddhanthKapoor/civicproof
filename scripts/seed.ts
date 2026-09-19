/**
 * Seeds demo reports:  npm run seed
 *
 * Demo reports are illustrative: nobody observed these exact conditions for CivicProof, and
 * nothing has been filed with any authority. They exist so the workflow can be evaluated
 * without creating new reports. Every official record they link to is real and cited.
 * Works against whichever store is configured (local files or DynamoDB).
 */
import zlib from "node:zlib";
import { createCase, savePacket } from "../src/lib/cases";
import { runInvestigation } from "../src/lib/agent/run";
import { getStore } from "../src/lib/store";
import type { NewReport } from "../src/lib/schemas";
import type { PhotoObservation } from "../src/lib/agent/determination";

const NOTE =
  "Demo report created to show the workflow. The description is illustrative and nothing has been filed with any authority. The official records it links to are real and cited to the page.";

const DEMOS: Array<NewReport & { packet?: boolean; goldenA?: boolean }> = [
  {
    title: "Potholes along the Kodathi–Mullur road",
    description:
      "Several potholes about 30–40 cm across on the road from Kodathi towards Mullur, with broken edges near the colony turn. Two-wheelers are swerving into oncoming traffic to avoid them.",
    category: "pothole",
    lat: 12.894573,
    lng: 77.71297,
    locationSource: "map_pin",
    address: "Kodathi–Mullur road, Bengaluru East",
    observedOn: "2026-09-14",
    packet: true,
    goldenA: true,
  },
  {
    title: "Surface breaking up on the Hebbagodi–Hulimangala road",
    description:
      "The top layer has worn away over a stretch of roughly 100 m near Hulimangala, leaving loose aggregate and shallow potholes that fill with water after rain.",
    category: "road_damage",
    lat: 12.826842,
    lng: 77.617364,
    locationSource: "map_pin",
    address: "Hulimangala, Anekal taluk",
    observedOn: "2026-09-12",
    packet: true,
  },
  {
    title: "Potholes on Thimmaiah Road near Kamaraj Road",
    description: "A cluster of potholes on Thimmaiah Road close to the Kamaraj Road end, deep enough to jolt cars at low speed.",
    category: "pothole",
    lat: 12.989693,
    lng: 77.610844,
    locationSource: "map_pin",
    address: "Thimmaiah Road, Shivajinagar",
    observedOn: "2026-09-16",
  },
  {
    title: "Broken paving and a sunken patch on Lavelle Road",
    description:
      "Footpath paving is broken and part of the carriageway has sunk near a utility cover, about midway along Lavelle Road.",
    category: "road_damage",
    lat: 12.968104,
    lng: 77.592091,
    locationSource: "map_pin",
    address: "Lavelle Road, Ashok Nagar",
    observedOn: "2026-09-15",
  },
  {
    title: "Pothole at the Brigade Road and Residency Road junction",
    description: "A single deep pothole at the junction where Brigade Road meets Residency Road, on the left lane heading south.",
    category: "pothole",
    lat: 12.97262,
    lng: 77.60755,
    locationSource: "map_pin",
    address: "Brigade Road × Residency Road",
    observedOn: "2026-09-17",
  },
  {
    title: "Waterlogged pothole on an internal road in Jayanagar",
    description: "A pothole that holds water for days after rain, on an internal road in Jayanagar 4th Block.",
    category: "pothole",
    lat: 12.925,
    lng: 77.5838,
    locationSource: "map_pin",
    address: "Jayanagar 4th Block",
    observedOn: "2026-09-13",
  },
];


/**
 * A deterministic, visibly synthetic image: pseudo-random noise, not a photograph of anything. It
 * exists so the demo can exercise the photo path — it carries no claim about any real road, and it
 * could not be mistaken for one.
 */
function fixtureImage(w = 1024, h = 768): Buffer {
  let seed = 20260919;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16) & 0xff;
  const raw = Buffer.concat(
    Array.from({ length: h }, () => {
      const row = Buffer.alloc(w * 3);
      for (let i = 0; i < row.length; i++) row[i] = rnd();
      return Buffer.concat([Buffer.from([0]), row]);
    }),
  );
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * A recorded observation for the demo fixture, so the DEFECT_OBSERVED path is reachable on a
 * machine with no vision model. It is stored as an AI-origin, unverified claim labelled a demo
 * fixture — it can never become a verified fact or enter an official complaint.
 */
const DEMO_OBSERVATION: PhotoObservation = {
  infrastructure_damage_visible: true,
  visible_issues: ["potholes", "broken edges", "exposed aggregate"],
  description: "Demo fixture observation: potholes with broken edges and exposed aggregate across the carriageway.",
  severity: "moderate",
};

const FIXTURE_NOTE =
  "Demo fixture. The image attached to this report is generated noise, not a photograph, and the photo observation is a recorded fixture rather than a real observation. It exists so the defect-observed path can be shown without a vision model. The official records this case links to are real and cited to the page.";

async function main() {
  const existing = await getStore().list();
  if (existing.some((c) => c.demo) && !process.argv.includes("--force")) {
    console.log(`Demo reports already exist (${existing.filter((c) => c.demo).length}). Use --force to add another set.`);
    return;
  }
  const base = Date.parse("2026-09-18T03:30:00Z");
  for (const [i, d] of DEMOS.entries()) {
    const { packet, goldenA, ...report } = d;
    const bytes = goldenA ? new Uint8Array(fixtureImage()) : undefined;
    const { caseData } = await createCase(
      report,
      bytes ? [{ bytes, meta: { width: 1024, height: 768 }, credit: "Generated fixture image, not a photograph" }] : [],
      { demo: true, demoNote: goldenA ? FIXTURE_NOTE : NOTE, reportedAt: new Date(base + i * 7 * 60 * 1000).toISOString() },
    );
    const done = await runInvestigation(caseData.id, () => {}, goldenA ? { demoObservation: DEMO_OBSERVATION } : {});
    if (packet) await savePacket(caseData.id, null, "complaint", undefined, { system: true });
    const inv = done.investigation!;
    console.log(
      `${caseData.id}  ${d.title}\n   → ${inv.selectedProjectId ?? "no project"} · ${inv.claims.filter((c) => c.verification === "verified").length} verified · ${inv.missing.length} missing · next: ${inv.nextActions[0]?.title ?? "—"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
