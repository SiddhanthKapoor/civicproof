/**
 * End-to-end: a report on a real PMGSY road → Strands agent loop (rules planner) → Cedar →
 * verifier → finalize → persisted case → complaint and RTI packets.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
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
