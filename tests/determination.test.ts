import { describe, expect, it } from "vitest";
import { contractualStatus, fieldCondition, overallState, scopeRelationship, type PhotoObservation } from "@/lib/agent/determination";
import { CONTRACTUAL_STATUS, FIELD_CONDITION, IDENTITY_STATE, OVERALL_STATE, SCOPE_RELATIONSHIP } from "@/lib/schemas";
import type { Claim, Evidence, Determination } from "@/lib/schemas";
import type { Project } from "@/lib/corpus";

const claim = (over: Partial<Claim>): Claim => ({
  id: "c", field: "completion_date", text: "t", value: "v", evidenceIds: [],
  verification: "verified", confidence: 0.95, origin: "official_record", ...over,
});
const window = (value: string, over: Partial<Claim> = {}): Claim =>
  claim({ id: "w", field: "maintenance_window", value, origin: "computed", derivedFrom: ["c1", "c2"], ...over });

describe("contractual status", () => {
  it("is ACTIVE while the computed period still runs, and EXPIRED once it has passed", () => {
    expect(contractualStatus(window("inside:2027-03-05"), [], "2026-09-19")).toMatchObject({ value: "ACTIVE", windowEnd: "2027-03-05", observationInsideWindow: true });
    expect(contractualStatus(window("outside:2024-03-05"), [], "2026-09-19")).toMatchObject({ value: "EXPIRED", windowEnd: "2024-03-05" });
    // Computed from the observation date, but ACTIVE/EXPIRED is judged against today.
    expect(contractualStatus(window("inside:2026-01-01"), [], "2026-09-19").value).toBe("EXPIRED");
  });

  it("is UNKNOWN whenever an input is missing, and says which one", () => {
    expect(contractualStatus(undefined, [], "2026-09-19")).toMatchObject({ value: "UNKNOWN" });
    expect(contractualStatus(undefined, [], "2026-09-19").reason).toMatch(/Neither a completion date nor a defect-liability period/);
    // Golden Case B: a defect-liability period is on file but completion is not verified.
    const dlpOnly = [claim({ id: "d", field: "defect_liability", value: "5 years" })];
    expect(contractualStatus(undefined, dlpOnly, "2026-09-19")).toMatchObject({ value: "UNKNOWN" });
    expect(contractualStatus(undefined, dlpOnly, "2026-09-19").reason).toMatch(/not a verified completion date/);
  });

  it("is UNKNOWN when the dates conflict, or when the issue predates completion", () => {
    expect(contractualStatus(window("inside:2027-03-05", { verification: "contradicted" }), [], "2026-09-19").value).toBe("UNKNOWN");
    expect(contractualStatus(window("before_completion"), [], "2026-09-19").value).toBe("UNKNOWN");
  });
});

describe("field condition", () => {
  const obs = (over: Partial<PhotoObservation> = {}): PhotoObservation => ({
    infrastructure_damage_visible: true, visible_issues: ["pothole"], description: "A pothole.", severity: "moderate", ...over,
  });

  it("reports what the photograph shows", () => {
    expect(fieldCondition(1, obs(), { sufficient: true, reasons: [] }).value).toBe("DEFECT_OBSERVED");
    expect(fieldCondition(1, obs({ infrastructure_damage_visible: false }), { sufficient: true, reasons: [] }).value).toBe("NO_DEFECT_OBSERVED");
    expect(fieldCondition(1, obs({ severity: "unclear" }), { sufficient: true, reasons: [] }).value).toBe("HUMAN_REVIEW");
  });

  it("is INSUFFICIENT_EVIDENCE with no photo, and when no vision model ran", () => {
    expect(fieldCondition(0, undefined, undefined).value).toBe("INSUFFICIENT_EVIDENCE");
    expect(fieldCondition(1, undefined, { sufficient: true, reasons: [] }).value).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("lets a failed deterministic check override the model, and carries the recapture instruction", () => {
    const out = fieldCondition(1, obs(), { sufficient: false, reasons: ["the image is 320px on its short edge"], recapture: "Take the photo closer, in daylight." });
    expect(out.value).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.recapture).toBe("Take the photo closer, in daylight.");
  });
});

describe("scope relationship", () => {
  const project = { id: "p1", documents: ["doc-a"], categories: ["pothole"] } as unknown as Project;
  const evidence: Evidence[] = [
    { id: "ev-in", docId: "doc-a", sourceTitle: "Bid", sourceType: "official_pdf", retrievedAt: "2026-09-18", page: 1, excerpt: "x", verification: "verified", strength: "strong", relatedClaimIds: ["s"] },
    { id: "ev-out", docId: "doc-elsewhere", sourceTitle: "Other", sourceType: "official_pdf", retrievedAt: "2026-09-18", page: 1, excerpt: "x", verification: "verified", strength: "strong", relatedClaimIds: ["s2"] },
  ];
  const corpus = { getPage: (id: string, p: number) => (id === "doc-a" && p === 1 ? "page text" : undefined) };
  const scopeClaim = (evidenceIds: string[]) => claim({ id: "s", field: "scope", value: "White topping", evidenceIds });

  it("is POTENTIALLY_RELATED only from scope evidence inside this project's bundle", () => {
    expect(scopeRelationship("VERIFIED", project, "pothole", [scopeClaim(["ev-in"])], evidence, corpus).value).toBe("POTENTIALLY_RELATED");
  });

  it("will not accept a citation to a document outside the bundle, or a page that does not exist", () => {
    expect(scopeRelationship("VERIFIED", project, "pothole", [scopeClaim(["ev-out"])], evidence, corpus).value).toBe("UNKNOWN");
    const badPage: Evidence[] = [{ ...evidence[0], id: "ev-bad", page: 99 }];
    expect(scopeRelationship("VERIFIED", project, "pothole", [scopeClaim(["ev-bad"])], badPage, corpus).value).toBe("UNKNOWN");
  });

  it("does not assert a relationship it cannot ground", () => {
    expect(scopeRelationship("VERIFIED", project, "pothole", [], evidence, corpus).value).toBe("UNKNOWN");
    expect(scopeRelationship("UNVERIFIED", project, "pothole", [scopeClaim(["ev-in"])], evidence, corpus).value).toBe("UNKNOWN");
    // The project's scope does not cover this kind of work.
    expect(scopeRelationship("VERIFIED", project, "streetlight", [scopeClaim(["ev-in"])], evidence, corpus).value).toBe("NOT_ESTABLISHED");
  });

  it("never asserts causation in its wording", () => {
    const r = scopeRelationship("VERIFIED", project, "pothole", [scopeClaim(["ev-in"])], evidence, corpus);
    expect(r.reason).toMatch(/not established by the records/);
    expect(r.reason).not.toMatch(/caused|fault|liable|negligen/i);
  });
});

describe("overall state is a total function of the three determinations", () => {
  type Axes = Parameters<typeof overallState>[0];
  const all: Axes[] = [];
  for (const identity of IDENTITY_STATE)
    for (const contractual of CONTRACTUAL_STATUS)
      for (const field of FIELD_CONDITION)
        for (const scope of SCOPE_RELATIONSHIP) all.push({ identity, contractual, field, scope });

  // Restated from the specification, independently of the implementation's rule order.
  const expected = (a: Axes): Determination["overall"]["value"] => {
    if (a.identity !== "VERIFIED") return "UNVERIFIED";
    if (a.field === "HUMAN_REVIEW" || a.field === "INSUFFICIENT_EVIDENCE") return "UNKNOWN";
    if (a.contractual === "UNKNOWN") return "UNKNOWN";
    if (a.scope !== "POTENTIALLY_RELATED") return "UNKNOWN";
    if (a.field === "NO_DEFECT_OBSERVED") return "SUPPORTED";
    if (a.contractual === "EXPIRED") return "SUPPORTED";
    return "POTENTIAL_ISSUE";
  };

  it(`covers every combination (${3 * 3 * 4 * 3} of them) and matches the specification`, () => {
    expect(all).toHaveLength(108);
    for (const a of all) {
      const got = overallState(a);
      expect(OVERALL_STATE, JSON.stringify(a)).toContain(got.value);
      expect(got.value, JSON.stringify(a)).toBe(expected(a));
      expect(got.reason.length).toBeGreaterThan(10);
    }
  });

  it("Golden Case A: an open period, a visible defect and a related scope is a potential issue for review", () => {
    const a: Axes = { identity: "VERIFIED", contractual: "ACTIVE", field: "DEFECT_OBSERVED", scope: "POTENTIALLY_RELATED" };
    expect(overallState(a).value).toBe("POTENTIAL_ISSUE");
    expect(overallState(a).reason).toMatch(/requires human review/);
    // It must disclaim fault explicitly, and must never assert it.
    expect(overallState(a).reason).toMatch(/does not establish who is responsible/);
    expect(overallState(a).reason).not.toMatch(/\bcaused\b|\bat fault\b|\bliable\b|\bnegligen/i);
  });

  it("Golden Case B: an unknown period stays UNKNOWN even when a defect is plainly visible", () => {
    expect(overallState({ identity: "VERIFIED", contractual: "UNKNOWN", field: "DEFECT_OBSERVED", scope: "POTENTIALLY_RELATED" }).value).toBe("UNKNOWN");
  });

  it("an unestablished project makes everything downstream UNVERIFIED", () => {
    for (const identity of ["UNVERIFIED", "CODE_MATCHES_MULTIPLE_PROJECTS"] as const) {
      expect(overallState({ identity, contractual: "ACTIVE", field: "DEFECT_OBSERVED", scope: "POTENTIALLY_RELATED" }).value).toBe("UNVERIFIED");
    }
  });
});
