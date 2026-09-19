import { describe, expect, it } from "vitest";
import {
  MIN_LOCATION_SCORE,
  isValidJobCode,
  normalizeJobCode,
  resolveIdentityFromCode,
  resolveIdentityFromRecord,
} from "@/lib/agent/identity";
import { getCorpus } from "@/lib/corpus";
import type { Project } from "@/lib/corpus";
import type { Claim, Evidence } from "@/lib/schemas";

const corpus = getCorpus();
const lookup = (code: string) => corpus.findProjectsByCode(code);

describe("normalising and validating a work identifier", () => {
  it("tidies separators and case without guessing between look-alike characters", () => {
    expect(normalizeJobCode(" kn03-70 ")).toBe("KN03-70");
    expect(normalizeJobCode("KN 03 - 70")).toBe("KN03-70");
    expect(normalizeJobCode("KN03–70")).toBe("KN03-70"); // en dash
    // "O" is not silently read as "0": a wrong code must fail to match, not match the wrong project.
    expect(normalizeJobCode("KNO3-70")).toBe("KNO3-70");
  });

  it("accepts every identifier shape this registry actually uses", () => {
    for (const code of ["KN0201", "KN02100", "KN0219A", "KN03-70", "KN-02-32", "KN25127B", "BBMP/2023-24/RD/WORK_INDENT1733"]) {
      expect(isValidJobCode(code), code).toBe(true);
    }
  });

  it("rejects things that are not identifiers", () => {
    for (const code of ["", "POTHOLE", "12345", "KN", "KN0", "KNO3-70", "DROP TABLE PROJECTS"]) {
      expect(isValidJobCode(normalizeJobCode(code)), code).toBe(false);
    }
  });
});

describe("an identifier establishes identity; a location only orders candidates", () => {
  it("verifies a code that matches exactly one project", () => {
    const r = resolveIdentityFromCode({ rawText: "KN03-70", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("VERIFIED");
    expect(r.identity.registryMatches).toBe(1);
    expect(r.identity.patternValid).toBe(true);
    expect(r.projectId).toBe("pmgsy-kn03-70");
  });

  it("refuses to choose when a code matches several projects, and says how many", () => {
    // KN0204 is a PMGSY package number that repeats across blocks: 13 projects carry it, including
    // the rural road used in the Koira demo. A code alone cannot settle which one is meant.
    const all = lookup("KN0204");
    expect(all.length).toBeGreaterThan(1);
    expect(all.map((p) => p.id)).toContain("pmgsy-bengaluru-rural-kn0204");

    const r = resolveIdentityFromCode({ rawText: "KN0204", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("CODE_MATCHES_MULTIPLE_PROJECTS");
    expect(r.projectId).toBeUndefined();
    expect(r.identity.registryMatches).toBe(all.length);
    expect(r.identity.candidateProjectIds).toHaveLength(all.length);
    expect(r.identity.reason).toMatch(/has to be chosen/);
  });

  it("lets a person settle an ambiguous code by choosing from the narrowed list", () => {
    const chosen = "pmgsy-bengaluru-rural-kn0204";
    const r = resolveIdentityFromCode({ rawText: "KN0204", method: "manual_job_code", lookup, chosenProjectId: chosen });
    expect(r.identity.value).toBe("VERIFIED");
    expect(r.projectId).toBe(chosen);
    expect(r.identity.reason).toMatch(/chosen from that list/);
  });

  it("will not accept a choice outside the narrowed list", () => {
    const r = resolveIdentityFromCode({ rawText: "KN0204", method: "manual_job_code", lookup, chosenProjectId: "pmgsy-kn03-70" });
    expect(r.identity.value).toBe("CODE_MATCHES_MULTIPLE_PROJECTS");
    expect(r.projectId).toBeUndefined();
  });

  it("is UNVERIFIED when the code matches nothing in the registry", () => {
    const r = resolveIdentityFromCode({ rawText: "KN9999", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("UNVERIFIED");
    expect(r.identity.registryMatches).toBe(0);
    expect(r.identity.patternValid).toBe(true);
    expect(r.identity.reason).toMatch(/No project in the registry carries/);
  });

  it("is UNVERIFIED when the code is malformed, and says the format was not recognised", () => {
    const r = resolveIdentityFromCode({ rawText: "pothole on 5th main", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("UNVERIFIED");
    expect(r.identity.patternValid).toBe(false);
    expect(r.identity.registryMatches).toBeUndefined();
    expect(r.identity.reason).toMatch(/not in the form of a work or package identifier/);
  });

  it("never lets the location pick, even when it points at a different project than the code", () => {
    // The order function stands in for GPS: it puts a project the code did NOT match first.
    const decoy = corpus.getProject("pmgsy-kn03-70")!;
    const order = (candidates: Project[]) => [decoy, ...candidates.filter((p) => p.id !== decoy.id)];

    // Ambiguous code: ordering changes the offer, not the outcome.
    const ambiguous = resolveIdentityFromCode({ rawText: "KN0204", method: "manual_job_code", lookup, order });
    expect(ambiguous.identity.value).toBe("CODE_MATCHES_MULTIPLE_PROJECTS");
    expect(ambiguous.projectId).toBeUndefined();

    // Unambiguous code: the project the code matched wins, whatever the location says.
    const single = resolveIdentityFromCode({ rawText: "KN02120", method: "manual_job_code", lookup, order });
    if (single.identity.value === "VERIFIED") {
      expect(single.projectId).not.toBe(decoy.id);
      expect(lookup("KN02120").map((p) => p.id)).toContain(single.projectId);
    }
  });

  it("exposes what it was given, what it made of it, and how ambiguous the answer was", () => {
    const r = resolveIdentityFromCode({ rawText: " kn 0204 ", method: "manual_job_code", lookup });
    expect(r.identity.rawText).toBe(" kn 0204 ");
    expect(r.identity.normalizedCode).toBe("KN0204");
    expect(r.identity.patternValid).toBe(true);
    expect(r.identity.registryMatches).toBeGreaterThan(1);
    expect(r.identity.method).toBe("manual_job_code");
  });
});

describe("without an identifier, a project is established only by its record", () => {
  const project = corpus.getProject("pmgsy-kn03-70")!;
  const registryCode = project.reference.find((r) => r.field === "project_id")!.value!;
  const evidence: Evidence[] = [
    {
      id: "ev-good", docId: project.documents[0], sourceTitle: "OMMAS", sourceType: "official_pdf",
      retrievedAt: "2026-09-18", page: 1, excerpt: registryCode, verification: "verified",
      strength: "strong", relatedClaimIds: ["c-id"],
    },
    {
      id: "ev-outside", docId: "cag-karnataka-2025-11", sourceTitle: "CAG", sourceType: "audit_report",
      retrievedAt: "2026-09-18", page: 1, excerpt: registryCode, verification: "verified",
      strength: "strong", relatedClaimIds: ["c-id"],
    },
  ];
  const idClaim = (over: Partial<Claim> = {}): Claim => ({
    id: "c-id", field: "project_id", value: registryCode, text: `The package number is ${registryCode}.`,
    evidenceIds: ["ev-good"], verification: "verified", confidence: 0.95, origin: "official_record", ...over,
  });

  it("is VERIFIED when the identifier is confirmed verbatim inside the project's own bundle", () => {
    const id = resolveIdentityFromRecord({ project, claims: [idClaim()], evidence, corpus });
    expect(id.value).toBe("VERIFIED");
    expect(id.method).toBe("verified_record");
    expect(id.normalizedCode).toBe(registryCode);
    expect(id.reason).toMatch(/only narrowed the candidates/);
  });

  it("is UNVERIFIED when the identifier is not confirmed, cites another project's document, or disagrees", () => {
    // No project_id claim at all: a location match on its own does not establish identity.
    expect(resolveIdentityFromRecord({ project, claims: [], evidence, corpus }).value).toBe("UNVERIFIED");
    // Not verified verbatim.
    expect(resolveIdentityFromRecord({ project, claims: [idClaim({ verification: "partially_verified" })], evidence, corpus }).value).toBe("UNVERIFIED");
    // Cited from a document outside this project's bundle.
    expect(resolveIdentityFromRecord({ project, claims: [idClaim({ evidenceIds: ["ev-outside"] })], evidence, corpus }).value).toBe("UNVERIFIED");
    // A verified identifier that is not this project's.
    expect(resolveIdentityFromRecord({ project, claims: [idClaim({ value: "KN03-72" })], evidence, corpus }).value).toBe("UNVERIFIED");
  });

  it("is UNVERIFIED with no project at all", () => {
    const id = resolveIdentityFromRecord({ project: undefined, claims: [], evidence: [], corpus });
    expect(id.value).toBe("UNVERIFIED");
    expect(id.method).toBe("none");
  });

  it("names the road-name path when that is what suggested the project", () => {
    expect(resolveIdentityFromRecord({ project, claims: [], evidence, corpus, linkedBy: "name" }).method).toBe("road_name");
  });
});

describe("the location score floor", () => {
  it("is derived from the scoring in use, not invented", () => {
    // proximity contributes 0.7*(1 - d/r); at the default 750 m radius a candidate on the alignment
    // scores ~0.70 and one 375 m away ~0.35, so the floor sits between them.
    const scoreAt = (d: number, r = 750) => Math.round(0.7 * Math.max(0, 1 - d / r) * 100) / 100;
    expect(scoreAt(0)).toBeGreaterThan(MIN_LOCATION_SCORE);
    expect(scoreAt(375)).toBeLessThan(MIN_LOCATION_SCORE);
    expect(MIN_LOCATION_SCORE).toBeGreaterThan(0.5);
  });
});

describe("BBMP ward work-order numbers (Bengaluru city)", () => {
  it("accepts the two shapes BBMP's register actually uses, and nothing looser", () => {
    // Measured across the 3,979 distinct job numbers in the 2025-26 register: ward-year-serial,
    // plus a handful carrying an "O" prefix. A bare number is not an identifier.
    expect(isValidJobCode(normalizeJobCode("176-20-000042"))).toBe(true);
    expect(isValidJobCode(normalizeJobCode("o132-23-000001"))).toBe(true);
    expect(isValidJobCode(normalizeJobCode("176-20-42"))).toBe(false);
    expect(isValidJobCode(normalizeJobCode("2"))).toBe(false);
    expect(isValidJobCode(normalizeJobCode("1762000042"))).toBe(false);
  });

  it("resolves a Bengaluru ward work order to exactly one project", () => {
    const r = resolveIdentityFromCode({ rawText: "176-20-000042", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("VERIFIED");
    expect(r.projectId).toBe("bbmp-ward176-btm-potholes");
  });

  it("refuses to choose when one ward job number covers several different works", () => {
    // BBMP files the civil work, the detailed project report and the project-management
    // consultancy under one number, with three different contractors. None of them is "the"
    // project, so the case stays unverified until a person picks.
    const r = resolveIdentityFromCode({ rawText: "119-23-000003", method: "manual_job_code", lookup });
    expect(r.identity.value).toBe("CODE_MATCHES_MULTIPLE_PROJECTS");
    expect(r.candidates.length).toBe(3);
    expect(r.projectId).toBeUndefined();
  });

  it("does not invent a completion date or a maintenance period BBMP never recorded", () => {
    // The register records work, ward and contractor. It states no completion date and no
    // defect-liability term, and neither may appear as a fact about the project.
    const p = corpus.getProject("bbmp-ward176-btm-potholes")!;
    const fields = p.reference.map((r) => r.field);
    expect(fields).toEqual(expect.arrayContaining(["project_id", "agency", "contractor", "scope"]));
    expect(fields).not.toContain("completion_date");
    expect(fields).not.toContain("defect_liability");
    expect(fields).not.toContain("contract_value");
  });
});

describe("a ward-level work order may not be established by a locality name", () => {
  // BBMP's register names a ward, not the road a citizen is standing on. The corpus holds one of
  // the 28 works recorded in Kengeri, so a report matching "Kengeri" matching that one work is an
  // accident of curation. Its own work number establishes it; a place name does not.
  const project = corpus.getProject("bbmp-ward159-kengeri-roads")!;
  const registryCode = project.reference.find((r) => r.field === "project_id")!.value!;
  const evidence: Evidence[] = [
    { id: "ev1", docId: project.documents[0], sourceTitle: "BBMP work orders", sourceType: "open_data", retrievedAt: "2026-09-19", page: 13, excerpt: "x", verification: "verified", strength: "strong", relatedClaimIds: ["c1"] },
  ];
  const idClaim: Claim = {
    id: "c1", field: "project_id", text: "t", value: registryCode, evidenceIds: ["ev1"],
    verification: "verified", confidence: 0.95, origin: "official_record",
  };

  it("is marked identifier-only in the corpus", () => {
    expect(project.identifiedBy).toBe("identifier");
  });

  it("refuses to establish identity from a road-name match, and says why", () => {
    const id = resolveIdentityFromRecord({ project, claims: [idClaim], evidence, corpus, linkedBy: "name" });
    expect(id.value).toBe("UNVERIFIED");
    expect(id.method).toBe("road_name");
    expect(id.reason).toMatch(/ward-level work order/);
    expect(id.reason).toMatch(/work number would establish it/);
  });

  it("refuses a location match for the same reason", () => {
    expect(resolveIdentityFromRecord({ project, claims: [idClaim], evidence, corpus, linkedBy: "location" }).value).toBe("UNVERIFIED");
  });

  it("still establishes a PMGSY road found by name, which its records do identify", () => {
    // The safeguard must not take away identity where the record names the road itself.
    const road = corpus.getProject("pmgsy-kn03-70")!;
    expect(road.identifiedBy).toBeUndefined();
  });
});
