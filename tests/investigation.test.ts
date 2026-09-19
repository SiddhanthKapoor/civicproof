/**
 * End-to-end: a report on a real PMGSY road → Strands agent loop (rules planner) → Cedar →
 * verifier → finalize → persisted case → complaint and RTI packets.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import zlib from "node:zlib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wordCount } from "@/lib/packet-text";
import { buildRti } from "@/lib/packet";
import { getCorpus } from "@/lib/corpus";
import { toPublicCase } from "@/lib/schemas";

let createCase: typeof import("@/lib/cases").createCase;
let savePacket: typeof import("@/lib/cases").savePacket;
let recordTimeline: typeof import("@/lib/cases").recordTimeline;
let ownerPackets: typeof import("@/lib/cases").ownerPackets;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let getStore: typeof import("@/lib/store").getStore;

beforeAll(async () => {
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-test-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "rules");
  ({ createCase, savePacket, recordTimeline, ownerPackets } = await import("@/lib/cases"));
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ getStore } = await import("@/lib/store"));
});

const base = {
  title: "Broken surface on the Kodathi road",
  description: "Large potholes and broken edges along the road towards Mullur, about 200 m long.",
  category: "pothole" as const,
  locationSource: "map_pin" as const,
  observedOn: "2026-09-15",
};

describe("investigation", () => {
  it("links a report to the PMGSY road and verifies facts against OMMAS", async () => {
    const { caseData, ownerKey } = await createCase({ ...base, lat: 12.894573, lng: 77.71297 }, []);
    const events: string[] = [];
    const done = await runInvestigation(caseData.id, (e) => events.push(e.type));
    const inv = done.investigation!;

    expect(inv.status).toBe("complete");
    expect(inv.selectedProjectId).toBe("pmgsy-kn03-70");
    expect(done.status).toBe("evidence_found");

    const contractor = inv.claims.find((c) => c.field === "contractor");
    expect(contractor?.verification).toBe("verified");
    expect(contractor?.value).toBe("Venkatarama Reddy .M");

    // 5 Mar 2022 + 5 years → window ends 5 Mar 2027; observed 15 Sep 2026 is inside.
    const window = inv.claims.find((c) => c.field === "maintenance_window");
    expect(window?.origin).toBe("computed");
    expect(window?.value).toBe("inside:2027-03-05");
    expect(inv.nextActions[0].type).toBe("defect_liability_repair_request");

    // Every verified official claim cites evidence that was found verbatim.
    for (const c of inv.claims.filter((c) => c.verification === "verified" && c.origin === "official_record")) {
      expect(c.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(events).toContain("claim");
    expect(inv.trace.some((t) => t.tool === "find_projects_near")).toBe(true);

    // Packets are built from verified facts only.
    // A stranger gets a draft but nothing is written to the case.
    const anon = await savePacket(caseData.id, null, "complaint");
    expect(anon.persisted).toBe(false);
    expect(anon.caseData.packets.complaint).toBeUndefined();

    const { caseData: withPacket } = await savePacket(caseData.id, ownerKey, "complaint");
    const body = withPacket.packets.complaint!.sections.map((s) => s.body).join("\n");
    expect(body).toContain("Venkatarama Reddy .M");
    expect(body).toContain("KN03-70");
    expect(withPacket.status).toBe("case_prepared");

    const rti = await savePacket(caseData.id, null, "rti");
    expect(rti.packet.subject).toContain("Section 6(1)");
    // Karnataka RTI Rules, rule 14: one subject, ordinarily at most 150 words; no reasons (s.6(2)).
    const request = rti.packet.sections.find((s) => s.id === "information")!.body;
    expect(request).toMatch(/^Subject matter: records of the work/);
    expect(wordCount(request)).toBeLessThanOrEqual(150);
    expect(rti.packet.sections.map((s) => s.id)).not.toContain("context");
    expect(rti.packet.disclaimer).toContain("rule 14");
    // A case with many open questions: extra records move to a note for a second application.
    const corpus = getCorpus();
    const project = corpus.getProject("pmgsy-kn03-70")!;
    const many = structuredClone(done);
    many.investigation!.missing = Array.from({ length: 12 }, (_, i) => ({
      field: "scope" as const,
      label: `Record ${i + 1}`,
      reason: "Not stated in the documents available to CivicProof.",
      requestableRecord: `Measurement book entries for reach ${i + 1} of this work, with the dates of measurement and check-measurement`,
    }));
    const long = buildRti(many, project, corpus.getAuthority(project.agencyId));
    expect(wordCount(long.sections.find((s) => s.id === "information")!.body)).toBeLessThanOrEqual(150);
    expect(long.disclaimer).toMatch(/left out and can be asked for in a separate application: Measurement book entries for reach \d+/);

    // Only the owner can record a submission.
    await expect(recordTimeline(caseData.id, "wrong-key", { type: "complaint_submitted", channel: "CPGRAMS", date: "2026-09-16", packet: "complaint" })).rejects.toThrow();
    const submitted = await recordTimeline(caseData.id, ownerKey, { type: "complaint_submitted", channel: "CPGRAMS", referenceNumber: "TEST/123", date: "2026-09-16", packet: "complaint" });
    expect(submitted.status).toBe("submitted");
  });

  it("finds the BBMP white-topping package in the city and flags the missing completion date", async () => {
    const { caseData } = await createCase({ ...base, title: "Pothole on Thimmaiah Road", lat: 12.989693, lng: 77.610844 }, []);
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;
    expect(inv.selectedProjectId).toBe("bbmp-whitetopping-2023-24-pkg2");
    expect(inv.claims.find((c) => c.field === "contractor")?.verification).toBe("verified");
    expect(inv.claims.some((c) => c.field === "maintenance_window")).toBe(false);
    expect(inv.missing.some((m) => m.field === "completion_date")).toBe(true);
    expect(inv.nextActions.some((a) => a.type === "rti_request")).toBe(true);
  });

  it("says so when no project matches", async () => {
    const { caseData } = await createCase({ ...base, title: "Pothole far from any project", lat: 12.93, lng: 77.55 }, []);
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;
    expect(inv.selectedProjectId).toBeUndefined();
    expect(inv.claims.filter((c) => c.verification === "verified")).toHaveLength(0);
    expect(inv.missing[0].field).toBe("project_name");
    expect(done.status).toBe("investigating");
  });

  it("lists cases", async () => {
    const list = await getStore().list();
    expect(list.length).toBeGreaterThanOrEqual(3);
  });
});

describe("rules planner, road found by name", () => {
  it("links a report to a rural road with no map line by the name in its address", async () => {
    const { caseData } = await createCase(
      { ...base, title: "Road breaking up near Koira", lat: 13.3034243, lng: 77.641612, address: "Koira Hosur road, Koira, Devanahalli" },
      [],
    );
    const inv = (await runInvestigation(caseData.id, () => {})).investigation!;
    expect(inv.selectedProjectId).toBe("pmgsy-bengaluru-rural-kn0204");
    expect(inv.matches[0]).toMatchObject({ linkedBy: "name" });
    expect(inv.claims.find((c) => c.field === "contractor")?.verification).toBe("verified");
    // PMGSY-I road completed in 2005: the 5-year window closed long ago, and the case says so.
    expect(inv.claims.find((c) => c.field === "maintenance_window")?.value).toMatch(/^outside:/);
  });
});

describe("RTI first appeal", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const fileRti = async (title: string, filedDaysAgo: number) => {
    const { caseData, ownerKey } = await createCase({ ...base, title, lat: 12.894573, lng: 77.71297 }, []);
    await recordTimeline(caseData.id, ownerKey, { type: "complaint_submitted", channel: "RTI Online (Karnataka)", referenceNumber: "KA/RTI/2026/1", date: daysAgo(filedDaysAgo), packet: "rti" });
    return { id: caseData.id, ownerKey };
  };
  const appealText = async (id: string) => (await savePacket(id, null, "appeal")).packet.sections.map((s) => s.body).join("\n");

  it("needs a recorded RTI application, and a reply that is overdue or on record", async () => {
    const { caseData, ownerKey } = await createCase({ ...base, title: "Appeal gate test case", lat: 12.894573, lng: 77.71297 }, []);
    await expect(savePacket(caseData.id, ownerKey, "appeal")).rejects.toThrow(/recorded RTI application/);
    const waiting = await fileRti("Appeal waiting test case", 3);
    await expect(savePacket(waiting.id, waiting.ownerKey, "appeal")).rejects.toThrow(/is due by/);
  });

  it("appeals a deemed refusal when no reply came within 30 days", async () => {
    const { id } = await fileRti("Appeal overdue test case", 40);
    const text = await appealText(id);
    expect(text).toContain("KA/RTI/2026/1");
    expect(text).toContain("deemed a refusal");
    expect(text).toContain("within 30 days of that date");
    expect(text).toContain("Section 7(6)");
  });

  it("asks for the delay to be condoned once the appeal window has passed", async () => {
    const text = await appealText((await fileRti("Appeal late test case", 75)).id);
    expect(text).toContain("condoned under the proviso to Section 19(1)");
  });

  it("appeals a reply the reporter disagrees with, without claiming there was none", async () => {
    const { id, ownerKey } = await fileRti("Appeal reply test case", 20);
    await recordTimeline(id, ownerKey, { type: "response_received", date: daysAgo(5), notes: "Partial reply: work order not supplied." });
    const text = await appealText(id);
    expect(text).toContain("reply was received on");
    expect(text).toContain("I am aggrieved");
    expect(text).not.toContain("deemed a refusal");
    expect(text).not.toContain("Section 7(6)"); // the reply came in time
    const c = await getStore().get(id);
    expect(c!.status).toBe("submitted"); // a reply doesn't mean the case is waiting or resolved
  });
});

describe("privacy", () => {
  it("keeps the reporter's name, contact and saved packets to the owner", async () => {
    const { caseData, ownerKey } = await createCase(
      { ...base, title: "Privacy test case", lat: 12.894573, lng: 77.71297, reporterName: "Asha Rao", reporterContact: "asha@example.org" },
      [],
    );
    await runInvestigation(caseData.id, () => {});
    await savePacket(caseData.id, ownerKey, "complaint");
    const stored = (await getStore().get(caseData.id))!;
    const pub = toPublicCase(stored);
    expect(JSON.stringify(pub)).not.toMatch(/Asha Rao|asha@example/);
    expect(pub.savedPackets).toEqual(["complaint"]);

    const mine = await ownerPackets(caseData.id, ownerKey);
    expect(mine.packets.complaint!.sections.find((s) => s.id === "sender")!.body).toContain("Asha Rao");
    await expect(ownerPackets(caseData.id, null)).rejects.toThrow(/Only the person/);
    const publicDraft = (await savePacket(caseData.id, null, "complaint")).packet;
    expect(JSON.stringify(publicDraft)).not.toMatch(/Asha Rao|asha@example/);
  });
});

describe("reporter documents", () => {
  it("stores an upload privately, extracts its text and lets the investigator read it", async () => {
    const { readFileSync } = await import("node:fs");
    const { addCaseDocument, readCaseDocumentPages } = await import("@/lib/cases");
    const { caseData, ownerKey } = await createCase({ ...base, title: "Document upload test case", lat: 12.826842, lng: 77.617364 }, []);
    const bytes = new Uint8Array(readFileSync("corpus/documents/ommas-quality-grading-bangalore-urban.pdf"));

    await expect(addCaseDocument(caseData.id, "not-the-key", { name: "reply.pdf", bytes }, { title: "PIO reply", kind: "rti_reply" })).rejects.toThrow(/Only the person/);

    const { caseData: withDoc, document } = await addCaseDocument(caseData.id, ownerKey, { name: "reply.pdf", bytes }, { title: "PIO reply", kind: "rti_reply" });
    expect(document.pageCount).toBe(2);
    expect(document.textPages).toBe(2);
    expect(withDoc.timeline.at(-1)?.type).toBe("evidence_added");
    expect((await readCaseDocumentPages(document))[0]).toContain("Works Wise Grading Abstract");
    await expect(addCaseDocument(caseData.id, ownerKey, { name: "again.pdf", bytes }, { title: "Again", kind: "other" })).rejects.toThrow(/already/);

    const done = await runInvestigation(caseData.id, () => {});
    expect(done.investigation!.trace.some((t) => t.tool === "read_document_page" && t.summary.includes("uploaded by the reporter"))).toBe(true);
  });
});

const KEY_FIELD_NAMES = ["project_name", "agency", "contractor", "contract_value", "completion_date", "defect_liability", "scope"];

describe("identity: identifier-first, never identifier-required", () => {
  const run = async (over: Record<string, unknown>) => {
    const { caseData } = await createCase({ ...base, lat: 12.894573, lng: 77.71297, ...over } as never, []);
    await runInvestigation(caseData.id, () => {});
    const done = (await getStore().get(caseData.id))!;
    return { done, d: done.investigation!.determination! };
  };

  it("case 1: an unambiguous identifier establishes the project outright", async () => {
    const { done, d } = await run({ title: "Potholes on the Kodathi road, board says KN03-70", jobCode: "KN03-70" });
    expect(d.identity.value).toBe("VERIFIED");
    expect(d.identity.method).toBe("manual_job_code");
    expect(d.identity.normalizedCode).toBe("KN03-70");
    expect(d.identity.registryMatches).toBe(1);
    expect(done.investigation!.selectedProjectId).toBe("pmgsy-kn03-70");
    expect(done.investigation!.matches[0].linkedBy).toBe("job_code");
  });

  it("case 1b: an identifier that matches many projects narrows, shows them, and picks none", async () => {
    // KN0204 is carried by 13 PMGSY projects across different blocks.
    const { done, d } = await run({ title: "Road broken near Koira, board reads KN0204", jobCode: "KN0204" });
    expect(d.identity.value).toBe("CODE_MATCHES_MULTIPLE_PROJECTS");
    expect(d.identity.registryMatches).toBeGreaterThan(1);
    expect(d.identity.candidateProjectIds!.length).toBeGreaterThan(1);
    // Nothing was chosen on the reporter's behalf, and the overall state says so.
    expect(done.investigation!.selectedProjectId).toBeUndefined();
    expect(d.overall.value).toBe("UNVERIFIED");
    // The candidates are still offered, so a person can settle it.
    expect(done.investigation!.matches.length).toBeGreaterThan(1);
    // And the gap explains itself rather than failing silently.
    expect(done.investigation!.missing.some((m) => m.field === "location_match")).toBe(true);
    const gap = done.investigation!.missing.find((m) => m.field === "location_match")!;
    expect(gap.whyItMatters).toBeTruthy();
    expect(gap.requestableRecord).toBeTruthy();
  });

  it("case 1c: a malformed identifier is rejected but does not poison the case", async () => {
    // The supplied code cannot be looked up, so the project's own record is still allowed to
    // establish identity — a typo in an optional field must not be worse than leaving it blank.
    const { done, d } = await run({ title: "Pothole here, the board was unreadable", jobCode: "??unreadable??" });
    expect(d.identity.patternValid).toBe(false);
    expect(d.identity.value).toBe("VERIFIED");
    expect(d.identity.method).toBe("verified_record");
    expect(d.identity.reason).toMatch(/not in the form of an identifier/);
    expect(d.identity.reason).toMatch(/established from the verified project record/);
    expect(done.id).toMatch(/^CP-/);
    expect(done.description).toBe(base.description);
  });

  it("case 1d: a well-formed code that matches nothing also falls through to the record", async () => {
    const { d } = await run({ title: "Pothole, the board reads KN9999", jobCode: "KN9999" });
    expect(d.identity.patternValid).toBe(true);
    expect(d.identity.registryMatches).toBe(0);
    expect(d.identity.value).toBe("VERIFIED");
    expect(d.identity.reason).toMatch(/matches no project in the registry/);
  });

  it("case 1e: a rejected code with nothing to fall back to stays UNVERIFIED", async () => {
    const { d } = await run({ title: "Pothole on an internal road elsewhere", jobCode: "not-a-code", lat: 12.93, lng: 77.55 });
    expect(d.identity.value).toBe("UNVERIFIED");
    expect(d.overall.value).toBe("UNVERIFIED");
    expect(d.identity.reason).toMatch(/could not be looked up/);
  });

  it("a location-suggested project never reports a live contract while its identity is unestablished", async () => {
    // Lavelle Road: a project sits at this location but carries no work identifier in its records.
    const { d } = await run({ title: "Broken paving and a sunken patch on Lavelle Road", lat: 12.971, lng: 77.5976 });
    if (d.identity.value !== "VERIFIED") {
      expect(d.contractualStatus.value).toBe("UNKNOWN");
      expect(d.overall.value).toBe("UNVERIFIED");
    }
  });

  it("evidence completeness and the missing checklist never contradict each other", async () => {
    // Both apply the same substitution rule, so a sanctioned cost answers the contract-value slot
    // in the count and in the checklist alike.
    for (const title of ["Broken surface on the Kodathi road", "Surface breaking up on the Hebbagodi road"]) {
      const { done, d } = await run({ title });
      const satisfied = d.completeness.have;
      const outstanding = done.investigation!.missing.filter((m) => KEY_FIELD_NAMES.includes(m.field)).length;
      expect(satisfied + outstanding, `${title}: ${satisfied} satisfied + ${outstanding} missing != ${d.completeness.of}`).toBe(d.completeness.of);
    }
  });

  it("case 2: with no identifier at all, the case still runs and identity rests on the record", async () => {
    const { done, d } = await run({ title: "Broken surface on the Kodathi road" });
    expect(done.jobCode).toBeUndefined();
    expect(d.identity.value).toBe("VERIFIED");
    // Not the location: the project's own record is what established it.
    expect(d.identity.method).toBe("verified_record");
    expect(d.identity.reason).toMatch(/only narrowed the candidates/);
  });

  it("preserves field evidence and refuses contractual conclusions when identity is not established", async () => {
    const { done, d } = await run({ title: "Waterlogged pothole on an internal road", lat: 12.93, lng: 77.55 });
    expect(d.identity.value).toBe("UNVERIFIED");
    expect(d.overall.value).toBe("UNVERIFIED");
    expect(d.contractualStatus.value).toBe("UNKNOWN");
    expect(d.scopeRelationship.value).toBe("UNKNOWN");
    // The case is kept and is still actionable as an information request.
    expect(done.status).toBe("investigating");
    expect(done.investigation!.missing.length).toBeGreaterThan(0);
    expect(done.investigation!.nextActions.some((a) => a.type === "rti_request")).toBe(true);
    // But no repair request, which would name a contractor.
    expect(done.investigation!.nextActions.some((a) => a.type === "defect_liability_repair_request")).toBe(false);
  });
});

describe("golden cases", () => {
  const OBSERVATION = {
    infrastructure_damage_visible: true,
    visible_issues: ["potholes", "broken edges"],
    description: "Demo fixture observation: potholes with broken edges.",
    severity: "moderate" as const,
  };
  // A deterministic, visibly synthetic PNG — noise, not a photograph of anything. Noise rather than
  // flat colour so it does not compress below the size floor the sufficiency gate enforces.
  const fixtureImage = (w = 1024, h = 768) => {
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
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  };

  it("Golden Case A: verified identity + active period + observed defect + related scope = POTENTIAL_ISSUE", async () => {
    const { caseData } = await createCase(
      { ...base, title: "Potholes along the Kodathi–Mullur road", lat: 12.894573, lng: 77.71297 } as never,
      [{ bytes: fixtureImage(), meta: { width: 1024, height: 768 }, credit: "Generated fixture image, not a photograph" }] as never,
    );
    await runInvestigation(caseData.id, () => {}, { demoObservation: OBSERVATION });
    const done = (await getStore().get(caseData.id))!;
    const d = done.investigation!.determination!;

    expect(d.identity.value).toBe("VERIFIED");
    expect(d.contractualStatus.value).toBe("ACTIVE");
    expect(d.fieldCondition.value).toBe("DEFECT_OBSERVED");
    expect(d.scopeRelationship.value).toBe("POTENTIALLY_RELATED");
    expect(d.overall.value).toBe("POTENTIAL_ISSUE");
    expect(d.requiresHumanReview).toBe(true);

    // The observation stays an unverified AI-origin claim, labelled as a fixture.
    const obs = done.investigation!.claims.find((c) => c.field === "photo_observation")!;
    expect(obs.origin).toBe("ai_inference");
    expect(obs.verification).toBe("unverified");
    expect(obs.notes).toMatch(/Demo fixture/);

    // And nothing anywhere in the determination assigns responsibility.
    const text = JSON.stringify(d).replace(/It does not establish who is responsible for the defect\./g, "");
    expect(text).not.toMatch(/\bcaused\b|\bat fault\b|\bliable\b|\bnegligen/i);
  });

  it("Golden Case B: an unknown period stays UNKNOWN even with a defect plainly observed", async () => {
    // Thimmaiah: a defect-liability clause is on file but no verified completion date.
    const { caseData } = await createCase(
      { ...base, title: "Potholes on Thimmaiah Road near Kamaraj Road", category: "pothole", lat: 12.989693, lng: 77.610844 } as never,
      [{ bytes: fixtureImage(), meta: { width: 1024, height: 768 }, credit: "Generated fixture image, not a photograph" }] as never,
    );
    await runInvestigation(caseData.id, () => {}, { demoObservation: OBSERVATION });
    const done = (await getStore().get(caseData.id))!;
    const d = done.investigation!.determination!;

    expect(d.identity.value).toBe("VERIFIED");
    expect(d.fieldCondition.value).toBe("DEFECT_OBSERVED");
    expect(d.contractualStatus.value).toBe("UNKNOWN");
    expect(d.overall.value).toBe("UNKNOWN"); // conservative: a visible defect does not create a contract
    expect(done.investigation!.missing.some((m) => m.field === "completion_date")).toBe(true);
  });

  it("a recorded observation is refused when the deterministic image gate fails", async () => {
    // 64x64 is below the resolution floor: the model's opinion must not rescue it.
    const { caseData } = await createCase(
      { ...base, title: "Potholes along the Kodathi–Mullur road", lat: 12.894573, lng: 77.71297 } as never,
      [{ bytes: fixtureImage(64, 64), meta: { width: 64, height: 64 } }] as never,
    );
    await runInvestigation(caseData.id, () => {}, { demoObservation: OBSERVATION });
    const d = (await getStore().get(caseData.id))!.investigation!.determination!;
    expect(d.fieldCondition.value).toBe("INSUFFICIENT_EVIDENCE");
    expect(d.fieldCondition.reason).toMatch(/short edge|not sufficient/);
    expect(d.overall.value).toBe("UNKNOWN");
  });
});
