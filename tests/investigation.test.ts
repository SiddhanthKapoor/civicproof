/**
 * End-to-end: a report on a real PMGSY road → Strands agent loop (rules planner) → Cedar →
 * verifier → finalize → persisted case → complaint and RTI packets.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let createCase: typeof import("@/lib/cases").createCase;
let savePacket: typeof import("@/lib/cases").savePacket;
let recordTimeline: typeof import("@/lib/cases").recordTimeline;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let getStore: typeof import("@/lib/store").getStore;

beforeAll(async () => {
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-test-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "rules");
  ({ createCase, savePacket, recordTimeline } = await import("@/lib/cases"));
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

describe("RTI first appeal", () => {
  it("drafts a Section 19(1) appeal only after an RTI submission is recorded", async () => {
    const { caseData, ownerKey } = await createCase({ ...base, title: "Appeal flow test case", lat: 12.894573, lng: 77.71297 }, []);
    await runInvestigation(caseData.id, () => {});
    await expect(savePacket(caseData.id, ownerKey, "appeal")).rejects.toThrow(/RTI submission/);
    await recordTimeline(caseData.id, ownerKey, { type: "complaint_submitted", channel: "RTI Online (Karnataka)", referenceNumber: "KA/RTI/2026/1", date: "2026-07-01", packet: "rti" });
    const { packet: appeal } = await savePacket(caseData.id, null, "appeal");
    expect(appeal.subject).toContain("Section 19(1)");
    const text = appeal.sections.map((s) => s.body).join("\n");
    expect(text).toContain("KA/RTI/2026/1");
    expect(text).toContain("Section 7(2)");
    expect(text).toContain("31 Jul 2026"); // reply was due 30 days after 1 Jul 2026
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
