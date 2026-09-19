import { describe, expect, it } from "vitest";
import { verifyClaim, type CorpusReader } from "@/lib/agent/verifier";
import { normaliseProposals } from "@/lib/agent/finalize";
import { buildComplaint, buildRti } from "@/lib/packet";
import type { Case, Claim, SourceDocument } from "@/lib/schemas";

/**
 * The product's central promise is that a model interprets and code verifies. These tests come at
 * it from the model's side: whatever a model proposes, nothing it authored may reach a Verified
 * badge or a document sent to an authority without passing the deterministic verifier.
 */
const doc: SourceDocument = {
  id: "doc-a", title: "Work order for resurfacing", publisher: "Test Municipal Corporation",
  sourceType: "official_pdf", url: "https://example.gov.in/wo.pdf", retrievedAt: "2026-09-18",
};
const page = "WORK ORDER\nName of work: Improvements to 5th Main Road, Ward 12\nSanctioned cost 364.29\nDate of completion: 31.03.2025";
const corpus: CorpusReader = {
  getDocument: (id) => (id === doc.id ? doc : undefined),
  getPage: (id) => (id === doc.id ? page : undefined),
  pageCount: () => 1,
};
const cite = (quote: string) => [{ docId: "doc-a", page: 1, quote }];

describe("nothing a model authored reaches Verified without the verifier", () => {
  it("refuses a claim that states no value, however genuine its quote", () => {
    const r = verifyClaim(
      { field: "contractor", text: "The work order names M/s Ghost Builders Pvt Ltd as the contractor.",
        origin: "official_record", citations: cite("Name of work: Improvements to 5th Main Road, Ward 12") },
      corpus, "2026-09-18",
    );
    expect(r.claim.verification).not.toBe("verified");
    expect(r.evidence[0].checkNote).toMatch(/no value to check/);
  });

  it("refuses a fabricated citation and demotes the claim off official_record", () => {
    const r = verifyClaim(
      { field: "contractor", text: "The contractor is M/s Invented Infra.", value: "M/s Invented Infra",
        origin: "official_record", citations: cite("Name of the Contractor: M/s Invented Infra Pvt Ltd") },
      corpus, "2026-09-18",
    );
    expect(r.claim.verification).toBe("unverified");
    expect(r.claim.origin).toBe("ai_inference");
    expect(r.rejections.length).toBeGreaterThan(0);
  });

  it("refuses a quantity whose unit cannot be established, even when the figure is on the page", () => {
    const r = verifyClaim(
      { field: "sanctioned_cost", text: "The sanctioned cost is 364.29.", value: "364.29",
        origin: "official_record", citations: cite("Sanctioned cost 364.29") },
      corpus, "2026-09-18",
    );
    expect(r.claim.verification).toBe("partially_verified");
    expect(r.rejections.join(" ")).toMatch(/no unit/);
  });

  it("drops a model-authored defect-liability window outright", () => {
    const authored: Claim = {
      id: "m1", field: "maintenance_window", value: "inside:2031-01-01",
      text: "The defect liability period runs until 1 Jan 2031.",
      evidenceIds: [], verification: "verified", confidence: 0.9, origin: "ai_inference",
    };
    expect(normaliseProposals([authored])).toHaveLength(0);
    // Even labelled official_record with a citation, it is still not computed, so it is still dropped.
    expect(normaliseProposals([{ ...authored, origin: "official_record", evidenceIds: ["e1"] }])).toHaveLength(0);
  });
});

describe("nothing a model authored reaches the complaint packet", () => {
  const claim = (over: Partial<Claim>): Claim => ({
    id: "c", field: "contractor", text: "text", value: "value", evidenceIds: [],
    verification: "verified", confidence: 0.9, origin: "official_record", ...over,
  });
  const determination = (identity: "VERIFIED" | "UNVERIFIED") => ({
    identity: { value: identity, method: identity === "VERIFIED" ? "verified_record" : "geographic", reason: "test" },
    contractualStatus: { value: "UNKNOWN", reason: "test", basedOnClaimIds: [] },
    fieldCondition: { value: "INSUFFICIENT_EVIDENCE", reason: "test" },
    scopeRelationship: { value: "UNKNOWN", reason: "test", basedOnClaimIds: [] },
    overall: { value: identity === "VERIFIED" ? "UNKNOWN" : "UNVERIFIED", reason: "test" },
    requiresHumanReview: false,
    completeness: { have: 1, of: 7 },
  });
  const caseWith = (claims: Claim[], identity: "VERIFIED" | "UNVERIFIED" = "VERIFIED"): Case => ({
    id: "CP-TEST-0001", title: "Potholes on a test road", description: "Surface is breaking up.",
    category: "pothole", location: { lat: 12.9, lng: 77.6, source: "map_pin" },
    observedOn: "2026-09-15", reportedAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
    photos: [], status: "evidence_found", demo: false, ownerKeyHash: "x".repeat(64),
    packets: {}, documents: [], timeline: [],
    investigation: {
      runId: "run_test", engine: "rules", status: "complete", startedAt: "2026-09-16T00:00:00.000Z",
      matches: [], claims, evidence: [], missing: [], conflicts: [], nextActions: [], trace: [],
      determination: determination(identity),
    },
  } as Case);

  it("prints only facts the verifier accepted from an official record", () => {
    const body = buildComplaint(
      caseWith([
        claim({ id: "ok", field: "contractor", value: "M/s Example Infra", text: "The contractor is M/s Example Infra." }),
        claim({ id: "ai", field: "contractor", value: "M/s Ghost Builders", text: "The contractor is M/s Ghost Builders.", origin: "ai_inference" }),
        claim({ id: "weak", field: "agency", value: "Some Division", text: "The agency is Some Division.", verification: "partially_verified" }),
      ]),
      undefined, undefined, new Date("2026-09-20T00:00:00Z"),
    ).sections.map((s) => s.body).join("\n");
    expect(body).toContain("M/s Example Infra");
    expect(body).not.toContain("Ghost Builders");
    expect(body).not.toContain("Some Division");
  });

  it("withholds the project's facts entirely until its identity is established", () => {
    // The facts are real and verified, but they describe a project this report has not been tied to.
    // Naming the wrong contract is the harm the product exists to avoid.
    const body = buildComplaint(
      caseWith([claim({ id: "ok", field: "contractor", value: "M/s Example Infra", text: "The contractor is M/s Example Infra." })], "UNVERIFIED"),
      undefined, undefined, new Date("2026-09-20T00:00:00Z"),
    ).sections.map((s) => s.body).join("\n");
    expect(body).not.toContain("M/s Example Infra");
    expect(body).toMatch(/could not (confirm its work identifier|identify the public-works project)/);
  });

  it("never prints a model-authored window as computed from the cited dates", () => {
    const authored = claim({ id: "w", field: "maintenance_window", value: "inside:2031-01-01",
      text: "The defect liability period runs until 1 Jan 2031.", origin: "ai_inference" });
    const body = buildComplaint(caseWith([authored]), undefined, undefined, new Date("2026-09-20T00:00:00Z"))
      .sections.map((s) => s.body).join("\n");
    expect(body).not.toContain("computed from the cited dates");
    expect(body).not.toContain("2031");
  });
});

describe("an official complaint never carries language the records do not support", () => {
  const claim = (over: Partial<Claim>): Claim => ({
    id: "c", field: "contractor", text: "text", value: "value", evidenceIds: [],
    verification: "verified", confidence: 0.9, origin: "official_record", ...over,
  });
  const determination = (identity: "VERIFIED" | "UNVERIFIED") => ({
    identity: { value: identity, method: identity === "VERIFIED" ? "verified_record" : "geographic", reason: "test" },
    contractualStatus: { value: "UNKNOWN", reason: "test", basedOnClaimIds: [] },
    fieldCondition: { value: "INSUFFICIENT_EVIDENCE", reason: "test" },
    scopeRelationship: { value: "UNKNOWN", reason: "test", basedOnClaimIds: [] },
    overall: { value: identity === "VERIFIED" ? "UNKNOWN" : "UNVERIFIED", reason: "test" },
    requiresHumanReview: false,
    completeness: { have: 1, of: 7 },
  });
  const caseWith = (claims: Claim[], identity: "VERIFIED" | "UNVERIFIED" = "VERIFIED"): Case => ({
    id: "CP-TEST-0002", title: "Potholes on a test road", description: "Surface is breaking up.",
    category: "pothole", location: { lat: 12.9, lng: 77.6, source: "map_pin" },
    observedOn: "2026-09-15", reportedAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
    photos: [], status: "evidence_found", demo: false, ownerKeyHash: "x".repeat(64),
    packets: {}, documents: [], timeline: [],
    investigation: {
      runId: "run_t", engine: "rules", status: "complete", startedAt: "2026-09-16T00:00:00.000Z",
      matches: [], claims, evidence: [], missing: [
        { field: "completion_date", label: "Completion date", reason: "Not stated in the documents available to CivicProof.",
          whyItMatters: "Without it the defect-liability period cannot be computed.", requestableRecord: "Completion certificate" },
      ], conflicts: [], nextActions: [], trace: [], determination: determination(identity),
    },
  } as Case);
  const body = (c: Case, kind: "complaint" | "rti" = "complaint") =>
    (kind === "complaint" ? buildComplaint(c, undefined, undefined, new Date("2026-09-20T00:00:00Z")) : buildRti(c, undefined, undefined, new Date("2026-09-20T00:00:00Z")))
      .sections.map((s) => s.body).join("\n");

  it("never alleges causation, fault, liability or negligence", () => {
    const text = body(caseWith([claim({ value: "M/s Example Infra", text: "The contractor is M/s Example Infra." })]));
    expect(text).not.toMatch(/\bat fault\b|\bliable\b|\bliability of\b|\bnegligen|\bresponsible for the damage\b/i);
    expect(text).not.toMatch(/\bcorrupt|\bfraud|\bmisuse of funds\b/i);
    // "caused" is allowed only inside a sentence denying that causation was established.
    for (const m of text.matchAll(/[^.]*\bcaused\b[^.]*\./g)) expect(m[0]).toMatch(/does not establish/i);
  });

  it("does not print a figure whose unit was never established", () => {
    // A unit-less cost cannot reach "verified" (the verifier caps it), so it must not appear as a fact.
    const text = body(caseWith([claim({ id: "cost", field: "sanctioned_cost", value: "364.29", text: "The sanctioned cost is 364.29.", verification: "partially_verified" })]));
    expect(text).not.toContain("364.29");
  });

  it("says what is missing rather than filling the gap", () => {
    const text = body(caseWith([claim({ value: "M/s Example Infra", text: "The contractor is M/s Example Infra." })]));
    expect(text).toMatch(/Completion date/i);
  });

  it("an information request still works when the project is not established, and asks for the record", () => {
    // This is exactly when an RTI is the right next step, so it must not be withheld.
    const text = body(caseWith([], "UNVERIFIED"), "rti");
    expect(text.length).toBeGreaterThan(100);
    expect(text).toMatch(/Completion certificate|completion/i);
  });

  it("is labelled a draft and states that nothing has been filed", () => {
    const packet = buildComplaint(caseWith([]), undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    const all = [packet.disclaimer ?? "", ...packet.sections.map((s) => s.body)].join("\n");
    expect(all).toMatch(/CivicProof has not sent this|draft/i);
  });

  it("keeps its own assessment in a section apart from the records, and disclaims responsibility", () => {
    // The reader has to be able to tell the citizen's account, the official records and
    // CivicProof's reading of them apart. They are three different kinds of statement.
    const packet = buildComplaint(caseWith([claim({ value: "M/s Example Infra" })]), undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    const ids = packet.sections.map((s) => s.id);
    expect(ids).toContain("issue"); // the citizen's account
    expect(ids).toContain("assessment"); // CivicProof's reading
    const assessment = packet.sections.find((s) => s.id === "assessment")!;
    expect(assessment.heading).toMatch(/assessment/i);
    expect(assessment.body).toMatch(/does not establish who caused the defect or who is responsible for it/i);
    expect(assessment.body).toMatch(/not a finding of fact/i);
    expect(assessment.body).not.toMatch(/\bat fault\b|\bliable\b|\bnegligen/i);
  });

  it("says where the submission destination came from, because it is not quoted from a record", () => {
    // Every fact in the packet is quoted from a cited page. The office it is addressed to is not:
    // it comes from CivicProof's authority directory. The citizen is the one who sends it, so the
    // packet has to admit the difference rather than let the office inherit the records' authority.
    const complaint = buildComplaint(caseWith([claim({ value: "M/s Example Infra" })]), undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    expect(complaint.disclaimer).toMatch(/directory of authorities, not from this project's documents/);
    expect(complaint.disclaimer).toMatch(/confirm it is the right office before sending/);

    const rti = buildRti(caseWith([]), undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    expect(rti.disclaimer).toMatch(/directory of authorities, not from this project's documents/);
    expect(rti.disclaimer).toMatch(/check the correct officer and fee rules/);
  });

  it("carries everything a citizen needs to paste into an official form", () => {
    const c = caseWith([
      claim({ value: "M/s Example Infra", text: "The contractor is M/s Example Infra." }),
      claim({ id: "obs", field: "photo_observation", value: "potholes and broken edges", origin: "ai_inference", verification: "unverified" }),
    ]);
    const packet = buildComplaint(c, undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    const text = [packet.subject, packet.addressedTo, ...packet.sections.map((x) => x.body), packet.disclaimer ?? ""].join("\n");

    expect(text).toContain("CP-TEST-0002");                       // the case it can be traced by
    expect(text).toContain("Potholes on a test road");            // what was reported
    expect(text).toMatch(/12\.900000, 77\.600000/);               // where
    expect(text).toMatch(/M\/s Example Infra/);                    // the verified contractor
    expect(text).toMatch(/Defect-liability status on 20 Sept 2026: UNKNOWN/); // the status, even when unknown
    expect(text).toMatch(/Completion date/);                      // named among the open questions
    expect(text).toMatch(/Inspect the reported location/);        // the request
    // The photograph is carried, and attributed to the reporter rather than to a record.
    expect(text).toMatch(/What the photograph shows, as recorded by the reporter: potholes and broken edges/);
    expect(text).toMatch(/not a record held by any authority/);
    // Evidence, explicitly not an allegation.
    expect(text).toMatch(/evidence placed side by side, not an allegation against anyone/);
    expect(text).toMatch(/does not establish who caused the defect or who is responsible for it/);
  });

  it("says a person must review it when the determination asks for one", () => {
    const c = caseWith([claim({ value: "M/s Example Infra" })]);
    c.investigation!.determination!.requiresHumanReview = true;
    const body = buildComplaint(c, undefined, undefined, new Date("2026-09-20T00:00:00Z")).sections.map((x) => x.body).join("\n");
    expect(body).toMatch(/Human review required: this case has been flagged for a person to examine/);
  });

  it("never calls anyone guilty, negligent, or the cause of the defect", () => {
    const c = caseWith([
      claim({ value: "M/s Example Infra" }),
      claim({ id: "obs", field: "photo_observation", value: "potholes and broken edges", origin: "ai_inference", verification: "unverified" }),
    ]);
    const packet = buildComplaint(c, undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    const text = [packet.subject, ...packet.sections.map((x) => x.body), packet.disclaimer ?? ""].join("\n");
    expect(text).not.toMatch(/\bguilty\b|\bnegligen|\bat fault\b|\bcaused this\b|\bis liable\b|\bwrongdoing\b|\bcorrupt/i);
    // "caused" may only ever appear inside a denial that causation was established.
    for (const m of text.matchAll(/[^.]*\bcaused\b[^.]*\./g)) expect(m[0]).toMatch(/does not establish/i);
  });

  it("states the assessment even when the project was never established", () => {
    // Saying "identity is not established" is the point of the section, so it must not be withheld
    // in exactly the case where the reader most needs it.
    const packet = buildComplaint(caseWith([], "UNVERIFIED"), undefined, undefined, new Date("2026-09-20T00:00:00Z"));
    const assessment = packet.sections.find((s) => s.id === "assessment");
    expect(assessment).toBeDefined();
    expect(assessment!.body).toMatch(/Project identity/);
  });
});
