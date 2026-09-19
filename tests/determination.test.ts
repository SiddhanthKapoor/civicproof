import { describe, expect, it } from "vitest";
import { contractualStatus, determine, fieldCondition, humanReviewReasons, overallState, photoSufficiency, scopeRelationship, type PhotoObservation } from "@/lib/agent/determination";
import { measureImage } from "@/lib/cases";
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
    expect(overallState(a).reason).toMatch(/requiring human\/authority review/);
    expect(overallState(a).reason).toMatch(/supports treating this as a potential project\/maintenance issue/);
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

describe("who is asked to review, and why", () => {
  const base = {
    window: undefined,
    claims: [] as Claim[],
    evidence: [] as Evidence[],
    project: undefined,
    category: "pothole" as const,
    corpus: { getPage: () => undefined },
    photoCount: 1,
    today: "2026-09-19",
    completeness: { have: 0, of: 7 },
  };
  const identity = (over: Partial<Determination["identity"]> = {}): Determination["identity"] => ({
    value: "VERIFIED",
    method: "manual_job_code",
    reason: "established for the test",
    ...over,
  });

  it("asks a person to choose when one work number is carried by several projects", () => {
    const d = determine({ ...base, identity: identity({ value: "CODE_MATCHES_MULTIPLE_PROJECTS", candidateProjectIds: ["a", "b", "c"] }) });
    expect(d.requiresHumanReview).toBe(true);
    const [first] = humanReviewReasons(d, []);
    expect(first.why).toMatch(/carried by 3 projects/);
    expect(first.resolvedBy).toMatch(/chooses the right project/);
  });

  it("asks a person to adjudicate when official records disagree", () => {
    const conflicting = [claim({ id: "x", field: "completion_date", verification: "contradicted" })];
    const d = determine({ ...base, identity: identity(), claims: conflicting });
    expect(d.requiresHumanReview).toBe(true);
    const [first] = humanReviewReasons(d, conflicting);
    expect(first.why).toMatch(/disagree on completion date/i);
    expect(first.why).toMatch(/neither has been chosen/i);
  });

  it("does not ask for review merely because a record is missing", () => {
    // A gap is answered by requesting the record — already a next action. Routing it to a person
    // would make the flag the generic escape hatch it is meant not to be.
    const d = determine({ ...base, identity: identity() });
    expect(d.contractualStatus.value).toBe("UNKNOWN");
    expect(d.requiresHumanReview).toBe(false);
    expect(humanReviewReasons(d, [])).toEqual([]);
  });

  it("never explains a review request in terms of cause, fault or liability", () => {
    const potentialIssue: Determination = {
      identity: identity(),
      contractualStatus: { value: "ACTIVE", windowEnd: "2027-03-05", reason: "r", basedOnClaimIds: [] },
      fieldCondition: { value: "HUMAN_REVIEW", reason: "the photograph does not settle how severe this is" },
      scopeRelationship: { value: "POTENTIALLY_RELATED", reason: "r", basedOnClaimIds: [] },
      overall: overallState({ identity: "VERIFIED", contractual: "ACTIVE", field: "DEFECT_OBSERVED", scope: "POTENTIALLY_RELATED" }),
      requiresHumanReview: true,
      completeness: { have: 7, of: 7 },
    };
    const contradicted = [claim({ id: "y", field: "contractor", verification: "contradicted" })];
    const reasons = humanReviewReasons(potentialIssue, contradicted);
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) {
      expect(`${r.why} ${r.resolvedBy}`).not.toMatch(/\bcaused\b|\bat fault\b|\bliable\b|\bnegligen|\bresponsible for\b/i);
    }
  });
});

describe("an image's size is measured, not taken on the uploader's word", () => {
  // The resolution floor is a deterministic safeguard. If it reads the width the client sent, a
  // 64x64 file can declare itself 1024x768 and walk through it.
  const png = (w: number, h: number) => {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // length, "IHDR"
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03]);
    new DataView(b.buffer).setUint16(13, h);
    new DataView(b.buffer).setUint16(15, w);
    return b;
  };

  it("reads the real dimensions out of a PNG and a JPEG header", () => {
    expect(measureImage(png(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(measureImage(png(64, 64))).toEqual({ width: 64, height: 64 });
    expect(measureImage(jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
  });

  it("returns nothing for bytes it cannot read, so the gate fails closed", () => {
    expect(measureImage(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(measureImage(png(0, 0))).toBeUndefined();
    expect(measureImage(new Uint8Array(0))).toBeUndefined();
  });

  it("refuses a small image whatever size it claims to be", () => {
    // Measured 64x64: below the floor however the upload described itself.
    const measured = measureImage(png(64, 64))!;
    const gate = photoSufficiency({ ...measured, bytes: 12_254 });
    expect(gate.sufficient).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/64px on its short edge/);
    // And a model insisting damage is visible cannot overturn it.
    expect(fieldCondition(1, { infrastructure_damage_visible: true, visible_issues: ["potholes"], description: "Potholes.", severity: "moderate" }, gate).value).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses a blank image that is large enough on paper but carries no detail", () => {
    // A flat white 1024x768 clears the resolution floor and is caught by the byte floor.
    const gate = photoSufficiency({ width: 1024, height: 768, bytes: 4_019 });
    expect(gate.sufficient).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/too small to carry usable detail/);
  });
});

describe("every input the determination claims to weigh actually gates it", () => {
  // Four of the eight are axes in the rule table. The other four — evidence verification, photo
  // sufficiency, conflicts and ambiguity — gate it earlier, by deciding whether an axis can be
  // established at all. These tests exercise the whole composition through determine(), so a
  // future change that routes around one of them fails here.
  const project = { id: "p1", documents: ["doc-a"], categories: ["pothole"] } as unknown as Project;
  const corpus = { getPage: (id: string, p: number) => (id === "doc-a" && p === 1 ? "page text" : undefined) };
  const evidence: Evidence[] = [
    { id: "ev1", docId: "doc-a", sourceTitle: "Bid", sourceType: "official_pdf", retrievedAt: "2026-09-18", page: 1, excerpt: "x", verification: "verified", strength: "strong", relatedClaimIds: ["s"] },
  ];
  const verifiedIdentity: Determination["identity"] = { value: "VERIFIED", method: "verified_record", reason: "established for the test" };
  const scopeClaim = (over: Partial<Claim> = {}) => claim({ id: "s", field: "scope", value: "White topping", evidenceIds: ["ev1"], ...over });
  const obs: PhotoObservation = { infrastructure_damage_visible: true, visible_issues: ["potholes"], description: "Potholes.", severity: "moderate" };

  /** The strong Bangalore case: every input present and positive. */
  const strong = () => ({
    identity: verifiedIdentity,
    window: window("inside:2027-03-05"),
    claims: [scopeClaim(), claim({ id: "cd", field: "completion_date", value: "05-03-2022" }), claim({ id: "dl", field: "defect_liability", value: "5 years" })],
    evidence,
    project,
    category: "pothole" as const,
    corpus,
    photoCount: 1,
    observation: obs,
    sufficiency: { sufficient: true, reasons: [] },
    today: "2026-09-19",
    completeness: { have: 7, of: 7 },
  });

  it("produces the intended result when every input supports it", () => {
    const d = determine(strong());
    expect(d.identity.value).toBe("VERIFIED");
    expect(d.fieldCondition.value).toBe("DEFECT_OBSERVED");
    expect(d.contractualStatus.value).toBe("ACTIVE");
    expect(d.scopeRelationship.value).toBe("POTENTIALLY_RELATED");
    expect(d.overall.value).toBe("POTENTIAL_ISSUE");
    expect(d.requiresHumanReview).toBe(true);
    expect(d.overall.reason).toContain("The available evidence supports treating this as a potential project/maintenance issue requiring human/authority review.");
    expect(d.overall.reason).toContain("The evidence does not establish who is responsible for the defect.");
  });

  it("1. identity: ambiguity or an unestablished project stops everything downstream", () => {
    for (const value of ["UNVERIFIED", "CODE_MATCHES_MULTIPLE_PROJECTS"] as const) {
      const d = determine({ ...strong(), identity: { ...verifiedIdentity, value, candidateProjectIds: ["a", "b"] } });
      expect(d.overall.value).toBe("UNVERIFIED");
      expect(d.contractualStatus.value).toBe("UNKNOWN");
      expect(d.scopeRelationship.value).toBe("UNKNOWN");
    }
  });

  it("2. evidence verification: a scope claim short of verified cannot ground a relationship", () => {
    for (const verification of ["partially_verified", "unverified"] as const) {
      const d = determine({ ...strong(), claims: [scopeClaim({ verification }), claim({ id: "cd", field: "completion_date", value: "05-03-2022" })] });
      expect(d.scopeRelationship.value).toBe("UNKNOWN");
      expect(d.overall.value).toBe("UNKNOWN");
    }
  });

  it("3. photo sufficiency: a failed gate outranks whatever the model reported", () => {
    const d = determine({ ...strong(), sufficiency: { sufficient: false, reasons: ["the image is 64px on its short edge"], recapture: "Take it again." } });
    expect(d.fieldCondition.value).toBe("INSUFFICIENT_EVIDENCE");
    expect(d.overall.value).toBe("UNKNOWN");
  });

  it("4. defect observation: no visible defect is SUPPORTED, not a potential issue", () => {
    const d = determine({ ...strong(), observation: { ...obs, infrastructure_damage_visible: false } });
    expect(d.fieldCondition.value).toBe("NO_DEFECT_OBSERVED");
    expect(d.overall.value).toBe("SUPPORTED");
  });

  it("5. contractual status: no window, or one that has run out, is never a potential issue", () => {
    expect(determine({ ...strong(), window: undefined }).overall.value).toBe("UNKNOWN");
    expect(determine({ ...strong(), window: window("outside:2024-03-05") }).overall.value).toBe("SUPPORTED");
  });

  it("6. scope: a project whose records cover other work is not connected by them", () => {
    const d = determine({ ...strong(), category: "streetlight" });
    expect(d.scopeRelationship.value).toBe("NOT_ESTABLISHED");
    expect(d.overall.value).toBe("UNKNOWN");
  });

  it("7. completeness is reported, and deliberately does not gate the outcome", () => {
    // A thin record must not silence a real issue: that would invert fail-closed, hiding problems
    // on exactly the projects whose paperwork is worst. It is shown, not used as a veto.
    const d = determine({ ...strong(), completeness: { have: 4, of: 7 } });
    expect(d.completeness).toEqual({ have: 4, of: 7 });
    expect(d.overall.value).toBe("POTENTIAL_ISSUE");
  });

  it("8. conflicts: contradicted records collapse the axis they feed, and call for a person", () => {
    // The dates the window rests on disagree. finalize appends the window to the claim list before
    // calling determine, so the test builds it the same way.
    const bad = window("inside:2027-03-05", { verification: "contradicted" });
    const contradicted = determine({ ...strong(), window: bad, claims: [...strong().claims, bad] });
    expect(contradicted.contractualStatus.value).toBe("UNKNOWN");
    expect(contradicted.overall.value).toBe("UNKNOWN");
    expect(contradicted.requiresHumanReview).toBe(true);
    // A contradicted scope claim is not verified, so it cannot ground the comparison either.
    const scopeConflict = determine({ ...strong(), claims: [scopeClaim({ verification: "contradicted" })] });
    expect(scopeConflict.scopeRelationship.value).toBe("UNKNOWN");
  });

  it("never reaches for a legal judgment, in any of the 108 outcomes", () => {
    for (const identity of IDENTITY_STATE)
      for (const contractual of CONTRACTUAL_STATUS)
        for (const field of FIELD_CONDITION)
          for (const scope of SCOPE_RELATIONSHIP) {
            // "defect-liability period" is the name of a contract clause, not a finding about a
            // person, so it is set aside before the wording is checked for legal conclusions.
            const r = overallState({ identity, contractual, field, scope }).reason.replace(/defect[- ]liability/gi, "");
            expect(r, `${identity}/${contractual}/${field}/${scope}`).not.toMatch(
              /\bliable\b|\bliability\b|\bnegligen|\bat fault\b|\bcaused\b|\bbreach\b|\bguilty\b|\bunlawful\b|\bdamages\b/i,
            );
          }
  });
});
