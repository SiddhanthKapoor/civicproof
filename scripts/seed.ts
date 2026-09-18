/**
 * Seeds demo reports:  npm run seed
 *
 * Demo reports are illustrative: nobody observed these exact conditions for CivicProof, and
 * nothing has been filed with any authority. They exist so the workflow can be evaluated
 * without creating new reports. Every official record they link to is real and cited.
 * Works against whichever store is configured (local files or DynamoDB).
 */
import { createCase, savePacket } from "../src/lib/cases";
import { runInvestigation } from "../src/lib/agent/run";
import { getStore } from "../src/lib/store";
import type { NewReport } from "../src/lib/schemas";

const NOTE =
  "Demo report created to show the workflow. The description is illustrative and nothing has been filed with any authority. The official records it links to are real and cited to the page.";

const DEMOS: Array<NewReport & { packet?: boolean }> = [
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

async function main() {
  const existing = await getStore().list();
  if (existing.some((c) => c.demo) && !process.argv.includes("--force")) {
    console.log(`Demo reports already exist (${existing.filter((c) => c.demo).length}). Use --force to add another set.`);
    return;
  }
  const base = Date.parse("2026-09-18T03:30:00Z");
  for (const [i, d] of DEMOS.entries()) {
    const { packet, ...report } = d;
    const { caseData } = await createCase(report, [], { demo: true, demoNote: NOTE, reportedAt: new Date(base + i * 7 * 60 * 1000).toISOString() });
    const done = await runInvestigation(caseData.id, () => {});
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
