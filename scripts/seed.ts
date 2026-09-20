/**
 * Seeds the demo reports:  npm run seed   (add --reset to rebuild the set in place)
 *
 * Demo reports are illustrative: nobody observed these exact conditions for CivicProof, and
 * nothing has been filed with any authority. They exist so the workflow can be evaluated
 * without creating new reports. Every official record they link to is real and cited.
 * Works against whichever store is configured (local files or DynamoDB).
 *
 * The set is deliberately small, and each case is here for one reason: to show a different state
 * the evidence can be in. Each carries the determination it must produce, and seeding **fails** if
 * a case comes out differently — a demo that silently shows the wrong state is worse than no demo,
 * because the whole claim being made is that these outcomes are derived rather than arranged.
 */
import zlib from "node:zlib";
import { createCase, savePacket } from "../src/lib/cases";
import { runInvestigation } from "../src/lib/agent/run";
import { getStore } from "../src/lib/store";
import type { Determination, NewReport } from "../src/lib/schemas";
import type { PhotoObservation } from "../src/lib/agent/determination";

const NOTE =
  "Demo report created to show the workflow. The description is illustrative and nothing has been filed with any authority. The official records it links to are real and cited to the page.";

const FIXTURE_NOTE =
  "Demo fixture. The image attached to this report is generated noise, not a photograph, and the photo observation is a recorded fixture rather than a real observation. It exists so the defect-observed path can be shown without a vision model. The official records this case links to are real and cited to the page.";

/** The determination a demo case must produce, checked after it is investigated. */
interface Expected {
  identity: Determination["identity"]["value"];
  contractualStatus: Determination["contractualStatus"]["value"];
  fieldCondition: Determination["fieldCondition"]["value"];
  scopeRelationship: Determination["scopeRelationship"]["value"];
  overall: Determination["overall"]["value"];
}

interface Demo extends NewReport {
  /** The case's letter, so an operator can find it in a list. */
  label: string;
  /** What this case exists to show. Printed by the seeder and written onto the case page. */
  shows: string;
  /** Attach the fixture image and its recorded observation, so the field-condition axis is live. */
  photo?: boolean;
  /** Save the complaint draft up front, so the packet is already on the case. */
  packet?: boolean;
  expect: Expected;
}

const DEMOS: Demo[] = [
  {
    label: "A",
    shows:
      "the complete chain: the project and its executing agency, the contractor named in the record, a recorded completion date, a defect-liability period still open, a usable photograph showing a defect, and a documented scope covering this road.",
    title: "Potholes along the Kodathi–Mullur road",
    description:
      "Several potholes about 30–40 cm across on the road from Kodathi towards Mullur, with broken edges near the colony turn. Two-wheelers are swerving into oncoming traffic to avoid them.",
    category: "pothole",
    lat: 12.894573,
    lng: 77.71297,
    locationSource: "map_pin",
    address: "Kodathi–Mullur road, Bengaluru East",
    observedOn: "2026-09-14",
    photo: true,
    packet: true,
    expect: {
      identity: "VERIFIED",
      contractualStatus: "ACTIVE",
      fieldCondition: "DEFECT_OBSERVED",
      scopeRelationship: "POTENTIALLY_RELATED",
      overall: "POTENTIAL_ISSUE",
    },
  },
  {
    label: "B",
    shows:
      "an evidence gap that is not filled in: the project and its scope are established from a tender document and the defect is plainly visible, but no completion date is on file, so the defect-liability period stays UNKNOWN instead of being estimated from the dates that are available.",
    title: "Potholes on Thimmaiah Road near Kamaraj Road",
    description: "A cluster of potholes on Thimmaiah Road close to the Kamaraj Road end, deep enough to jolt cars at low speed.",
    category: "pothole",
    lat: 12.989693,
    lng: 77.610844,
    locationSource: "map_pin",
    address: "Thimmaiah Road, Shivajinagar",
    observedOn: "2026-09-16",
    photo: true,
    expect: {
      identity: "VERIFIED",
      contractualStatus: "UNKNOWN",
      fieldCondition: "DEFECT_OBSERVED",
      scopeRelationship: "POTENTIALLY_RELATED",
      overall: "UNKNOWN",
    },
  },
  {
    label: "C",
    shows:
      "ambiguity kept rather than resolved: one BBMP ward job number covers three separate works — the civil work, the detailed project report and the project-management consultancy — under three different contractors, so the project stays UNVERIFIED and all three candidates are offered for a person to choose between.",
    title: "Broken road surface and missing drain covers in Ward 119",
    description:
      "The road surface has broken up across a long stretch and two drain covers are missing near the junction, leaving open holes next to the footpath.",
    category: "pothole",
    lat: 12.9716,
    lng: 77.5946,
    locationSource: "map_pin",
    address: "Ward 119, Bengaluru",
    jobCode: "119-23-000003",
    observedOn: "2026-09-11",
    photo: true,
    expect: {
      identity: "CODE_MATCHES_MULTIPLE_PROJECTS",
      contractualStatus: "UNKNOWN",
      fieldCondition: "DEFECT_OBSERVED",
      scopeRelationship: "UNKNOWN",
      overall: "UNVERIFIED",
    },
  },
  {
    label: "D",
    shows:
      "a maintenance period that has closed: OMMAS records both the completion of the works (1 June 2021) and a five-year defect-liability period, so the arithmetic puts its end at 1 June 2026 — before this report. The case states that the period has expired and stops there.",
    title: "Broken surface on the Boodihal–Channahalli road near Devanahalli",
    description:
      "The surface has cracked and broken up along the stretch between Boodihal and Channahalli, with loose metal and shallow potholes on the bends. Water stands on the worst patch for days after rain.",
    category: "road_damage",
    lat: 13.2073,
    lng: 77.74985,
    locationSource: "map_pin",
    address: "Boodihal–Channahalli stretch, Devanahalli taluk, Bengaluru Rural",
    jobCode: "KN02120",
    observedOn: "2026-09-15",
    photo: true,
    packet: true,
    expect: {
      identity: "VERIFIED",
      contractualStatus: "EXPIRED",
      fieldCondition: "DEFECT_OBSERVED",
      scopeRelationship: "POTENTIALLY_RELATED",
      overall: "SUPPORTED",
    },
  },
  {
    label: "E",
    shows:
      "the same UNKNOWN reached through a different register: the work number the reporter entered matches exactly one BBMP ward work order, which records the ward, the work and the contractor but neither a completion date nor a maintenance period.",
    title: "Potholes on the inner road in BTM Layout",
    description:
      "Several deep potholes along the inner road near the 16th Main junction in BTM Layout. Two-wheelers swerve around them and water collects in the largest one after rain.",
    category: "pothole",
    lat: 12.9166,
    lng: 77.6101,
    locationSource: "map_pin",
    address: "BTM Layout, Ward 176, Bengaluru",
    jobCode: "176-20-000042",
    observedOn: "2026-09-13",
    photo: true,
    expect: {
      identity: "VERIFIED",
      contractualStatus: "UNKNOWN",
      fieldCondition: "DEFECT_OBSERVED",
      scopeRelationship: "POTENTIALLY_RELATED",
      overall: "UNKNOWN",
    },
  },
  {
    label: "F",
    shows:
      "the gap on the other side: the project's obligations are established and the maintenance period is still open, but no photograph was submitted, so the condition on the ground is not assessed and the case does not conclude from the paperwork alone.",
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
    expect: {
      identity: "VERIFIED",
      contractualStatus: "ACTIVE",
      fieldCondition: "INSUFFICIENT_EVIDENCE",
      scopeRelationship: "POTENTIALLY_RELATED",
      overall: "UNKNOWN",
    },
  },
  {
    label: "G",
    shows:
      "why a nearby project is not an answer: the location does suggest one — TenderSURE Phase A Package 7 covers roads in this area, and facts about it are verified — but that record carries no work identifier to confirm against, so identity stays UNVERIFIED and nothing downstream is assessed. The report is still usable as a civic complaint.",
    title: "Broken paving and a sunken patch on Lavelle Road",
    description:
      "Footpath paving is broken and part of the carriageway has sunk near a utility cover, about midway along Lavelle Road.",
    category: "road_damage",
    lat: 12.968104,
    lng: 77.592091,
    locationSource: "map_pin",
    address: "Lavelle Road, Ashok Nagar",
    observedOn: "2026-09-15",
    expect: {
      identity: "UNVERIFIED",
      contractualStatus: "UNKNOWN",
      fieldCondition: "INSUFFICIENT_EVIDENCE",
      scopeRelationship: "UNKNOWN",
      overall: "UNVERIFIED",
    },
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

const AXES = ["identity", "contractualStatus", "fieldCondition", "scopeRelationship", "overall"] as const;

async function main() {
  const store = getStore();
  const existing = await store.list();
  const demos = existing.filter((c) => c.demo);

  if (demos.length && process.argv.includes("--reset")) {
    for (const c of demos) await store.delete(c.id);
    console.log(`Removed ${demos.length} existing demo report${demos.length === 1 ? "" : "s"}.`);
  } else if (demos.length && !process.argv.includes("--force")) {
    console.log(`Demo reports already exist (${demos.length}). Use --reset to rebuild the set, or --force to add another.`);
    return;
  }

  const base = Date.parse("2026-09-18T03:30:00Z");
  const failures: string[] = [];
  const rows: string[] = [];
  // Recording a submission, an authority's reply or a follow-up photograph is an owner action, so
  // without these keys the second half of the workflow cannot be shown on a demo case at all. They
  // are printed for demo reports only — the reports are illustrative and nothing has been filed.
  const keys: string[] = [];

  for (const [i, d] of DEMOS.entries()) {
    const { label, shows, photo, packet, expect, ...report } = d;
    const bytes = photo ? new Uint8Array(fixtureImage()) : undefined;
    const { caseData, ownerKey } = await createCase(
      report,
      bytes ? [{ bytes, meta: { width: 1024, height: 768 }, credit: "Generated fixture image, not a photograph" }] : [],
      {
        demo: true,
        demoLabel: label,
        demoNote: `Demo case ${label} — ${shows} ${photo ? FIXTURE_NOTE : NOTE}`,
        reportedAt: new Date(base + i * 7 * 60 * 1000).toISOString(),
      },
    );
    const done = await runInvestigation(caseData.id, () => {}, photo ? { demoObservation: DEMO_OBSERVATION } : {});
    if (packet) await savePacket(caseData.id, null, "complaint", undefined, { system: true });

    const inv = done.investigation!;
    const det = inv.determination;
    // The point of a demo case is the state it demonstrates. If the corpus, the verifier or the
    // determination rules move, this is where it must be noticed — not in front of an audience.
    const wrong = det
      ? AXES.filter((a) => det[a].value !== expect[a]).map((a) => `${a}: expected ${expect[a]}, got ${det[a].value}`)
      : ["no determination was produced"];
    if (wrong.length) failures.push(`Demo case ${label} (${d.title}):\n    ${wrong.join("\n    ")}`);

    keys.push(`  ${label}  ${caseData.id}  ${ownerKey}`);
    const verified = inv.claims.filter((c) => c.verification === "verified").length;
    rows.push(
      `  ${wrong.length ? "✗" : "✓"} ${label}  ${caseData.id}  ${det?.overall.value ?? "—"}\n` +
        `       ${d.title}\n` +
        `       ${inv.selectedProjectId ?? "no project"} · ${verified} verified · ${inv.missing.length} open question${inv.missing.length === 1 ? "" : "s"}` +
        `${det ? ` · DLP ${det.contractualStatus.value}` : ""} · next: ${inv.nextActions[0]?.title ?? "—"}`,
    );
  }

  console.log(`\nDemo set (${DEMOS.length} cases):\n${rows.join("\n")}`);
  if (failures.length) {
    console.error(`\n${failures.length} demo case${failures.length === 1 ? "" : "s"} did not produce the expected determination:\n\n${failures.join("\n\n")}\n`);
    process.exit(1);
  }
  console.log(
    `\nOwner keys for these demo reports — paste one into a case's Tracking panel to record a submission,` +
      `\nan authority's reply or a follow-up photograph. Demo reports only; nothing has been filed anywhere.\n${keys.join("\n")}`,
  );
  console.log("\nEvery demo case produced the determination it is meant to demonstrate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
