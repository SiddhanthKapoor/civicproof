import { describe, expect, it } from "vitest";
import { findQuote, parseAmounts, parseDates, parseDurationsMonths, valueSupported, normalizeText } from "@/lib/agent/text";
import { detectConflicts, verifyClaim, type CorpusReader } from "@/lib/agent/verifier";
import type { Claim } from "@/lib/schemas";
import type { SourceDocument } from "@/lib/schemas";

const doc: SourceDocument = {
  id: "doc-a",
  title: "Work order for resurfacing",
  publisher: "Test Municipal Corporation",
  sourceType: "official_pdf",
  url: "https://example.gov.in/wo.pdf",
  retrievedAt: "2026-09-18",
};
const pages: Record<number, string> = {
  1: "WORK ORDER\nName of work: Improvements to 5th Main Road, Ward 12\nName of the Contractor: M/s Example Infra\nprojects Pvt. Ltd.\nContract amount Rs. 1,25,00,000/- (Rupees One Crore Twenty Five Lakhs only)",
  2: "The Defect Liability Period shall be 2 (two) years from the date of completion.\nDate of completion: 31.03.2025",
};
const corpus: CorpusReader = {
  getDocument: (id) => (id === doc.id ? doc : undefined),
  getPage: (id, p) => (id === doc.id ? pages[p] : undefined),
  pageCount: () => 2,
};

describe("text normalisation", () => {
  it("handles typography and rupee symbols", () => {
    expect(normalizeText("₹ 12.5  Crore – “final”")).toBe('rs 12.5 crore - "final"');
  });
  it("parses Indian amounts", () => {
    expect(parseAmounts("Rs. 1,25,00,000/-")).toContain(12500000);
    expect(parseAmounts("₹ 1.25 crore")).toContain(12500000);
    expect(parseAmounts("125.00 lakhs")).toContain(12500000);
  });
  it("parses day-first and written dates", () => {
    expect(parseDates("31.03.2025")).toContain("2025-03-31");
    expect(parseDates("31st March, 2025")).toContain("2025-03-31");
    expect(parseDates("March 31, 2025")).toContain("2025-03-31");
    expect(parseDates("99.99.2025")).toHaveLength(0);
  });
  it("parses durations", () => {
    expect(parseDurationsMonths("2 (two) years")).toContain(24);
    expect(parseDurationsMonths("36 months")).toContain(36);
    expect(parseDurationsMonths("five years")).toContain(60);
  });
  it("matches values semantically", () => {
    expect(valueSupported("₹1.25 crore", "Contract amount Rs. 1,25,00,000/-")).toBe(true);
    expect(valueSupported("2025-03-31", "Date of completion: 31.03.2025")).toBe(true);
    expect(valueSupported("24 months", "shall be 2 (two) years")).toBe(true);
    expect(valueSupported("Example Infraprojects", "M/s Example Infra projects Pvt. Ltd.")).toBe(true);
    expect(valueSupported("Other Builders", "M/s Example Infra projects Pvt. Ltd.")).toBe(false);
  });
});

describe("findQuote", () => {
  it("finds excerpts across PDF line breaks", () => {
    expect(findQuote(pages[1], "Name of the Contractor: M/s Example Infraprojects Pvt. Ltd.").kind).toBe("exact");
  });
  it("rejects invented excerpts", () => {
    expect(findQuote(pages[1], "Name of the Contractor: M/s Totally Different Builders").kind).toBe("none");
  });
});

describe("verifyClaim", () => {
  it("verifies a claim whose value is in a verbatim excerpt", () => {
    const r = verifyClaim(
      {
        field: "contractor",
        text: "The work order names M/s Example Infraprojects Pvt. Ltd. as contractor.",
        value: "M/s Example Infraprojects Pvt. Ltd.",
        citations: [{ docId: "doc-a", page: 1, quote: "Name of the Contractor: M/s Example Infra projects Pvt. Ltd." }],
        origin: "official_record",
      },
      corpus,
      "2026-09-18",
    );
    expect(r.claim.verification).toBe("verified");
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].page).toBe(1);
  });

  it("does not verify a hallucinated value even when the excerpt is real", () => {
    const r = verifyClaim(
      {
        field: "sanctioned_cost",
        text: "Contract amount is ₹2.5 crore.",
        value: "₹2.5 crore",
        citations: [{ docId: "doc-a", page: 1, quote: "Contract amount Rs. 1,25,00,000/-" }],
        origin: "official_record",
      },
      corpus,
      "2026-09-18",
    );
    expect(r.claim.verification).toBe("partially_verified");
  });

  it("marks claims with fabricated citations as unverified", () => {
    const r = verifyClaim(
      {
        field: "project_id",
        text: "Tender number is BBMP/2024/999.",
        value: "BBMP/2024/999",
        citations: [
          { docId: "doc-a", page: 1, quote: "Tender No. BBMP/2024/999" },
          { docId: "doc-missing", page: 1, quote: "anything" },
          { docId: "doc-a", page: 9, quote: "anything at all" },
        ],
        origin: "official_record",
      },
      corpus,
      "2026-09-18",
    );
    expect(r.claim.verification).toBe("unverified");
    expect(r.claim.origin).toBe("ai_inference");
    expect(r.rejections).toHaveLength(3);
  });

  it("flags conflicting values instead of choosing one", () => {
    const a = verifyClaim(
      { field: "completion_date", text: "Completed 31.03.2025", value: "31.03.2025", citations: [{ docId: "doc-a", page: 2, quote: "Date of completion: 31.03.2025" }], origin: "official_record" },
      corpus,
      "2026-09-18",
    ).claim;
    const b = { ...a, id: "other", value: "2025-06-30" };
    const { claims, conflicts } = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(claims.every((c) => c.verification === "contradicted")).toBe(true);
  });

  it("merges the same fact recorded twice instead of calling it a conflict", () => {
    // Seen with Gemini: the same agency and cost recorded in two formats.
    const base = verifyClaim(
      { field: "completion_date", text: "Completed 31.03.2025", value: "31.03.2025", citations: [{ docId: "doc-a", page: 2, quote: "Date of completion: 31.03.2025" }], origin: "official_record" },
      corpus,
      "2026-09-18",
    ).claim;
    const pairs: Array<[Claim["field"], string, string]> = [
      ["agency", "DPIU Of Bangalore u", "DPIU Of Bangalore u (Bangalore Urban)"],
      ["sanctioned_cost", "364.29 Lakhs", "364.29"],
      ["completion_date", "05-03-2022", "5 Mar 2022"],
      ["contractor", "Venkatarama Reddy .M", "M. Venkatarama Reddy"],
    ];
    for (const [field, x, y] of pairs) {
      const one = { ...base, id: "one", field, value: x, evidenceIds: ["e1"] };
      const two = { ...base, id: "two", field, value: y, evidenceIds: ["e2"] };
      const { claims, conflicts } = detectConflicts([one, two]);
      expect(conflicts, `${x} / ${y}`).toHaveLength(0);
      expect(claims).toHaveLength(1);
      expect(claims[0].verification).toBe("verified");
      expect(claims[0].evidenceIds.sort()).toEqual(["e1", "e2"]);
    }
    // Different figures, or the same figure in different units, still conflict.
    for (const [x, y] of [["364.29 lakh", "364.29 crore"], ["KN03-70", "KN03-72"]]) {
      const { conflicts } = detectConflicts([
        { ...base, id: "one", field: "sanctioned_cost", value: x },
        { ...base, id: "two", field: "sanctioned_cost", value: y },
      ]);
      expect(conflicts, `${x} / ${y}`).toHaveLength(1);
    }
  });
});

describe("split unit support (table rows + unit notes)", () => {
  const tablePage = "5 Bangalore U DPIU Of Bangalore u Bangalore(E) KN03-70 2019 - 2020 ROAD\n364.29 152.84 4.250 0.000 4.250 268.89 Maintenance\nNote : All Costs are in Lakhs and All Lengths are in Kms.";
  const reader: CorpusReader = {
    getDocument: (id) => (id === "t" ? { ...doc, id: "t" } : undefined),
    getPage: (id, p) => (id === "t" && p === 1 ? tablePage : undefined),
    pageCount: () => 1,
  };
  it("verifies a figure whose unit is stated in a separate note", () => {
    const r = verifyClaim(
      {
        field: "sanctioned_cost",
        text: "Sanction cost ₹364.29 lakh",
        value: "₹364.29 lakh",
        citations: [
          { docId: "t", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89" },
          { docId: "t", page: 1, quote: "Note : All Costs are in Lakhs" },
        ],
        origin: "official_record",
      },
      reader,
      "x",
    );
    expect(r.claim.verification).toBe("verified");
  });
  it("does not verify a wrong unit", () => {
    const r = verifyClaim(
      {
        field: "sanctioned_cost",
        text: "Sanction cost ₹364.29 crore",
        value: "₹364.29 crore",
        citations: [
          { docId: "t", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89" },
          { docId: "t", page: 1, quote: "Note : All Costs are in Lakhs" },
        ],
        origin: "official_record",
      },
      reader,
      "x",
    );
    expect(r.claim.verification).toBe("partially_verified");
  });
  it("takes the unit from a note on the cited page when only the row was quoted, and cites the note", () => {
    // Seen with Gemini: it quoted the row, got "partially verified", then dropped the unit to pass.
    const r = verifyClaim(
      { field: "sanctioned_cost", text: "Sanction cost 364.29 lakh", value: "364.29 Lakhs", citations: [{ docId: "t", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89" }], origin: "official_record" },
      reader,
      "x",
    );
    expect(r.claim.verification).toBe("verified");
    expect(r.evidence.map((e) => e.excerpt)).toContain("Note : All Costs are in Lakhs and All Lengths are in Kms");
    // A unit the page doesn't state is still not accepted.
    const wrong = verifyClaim(
      { field: "sanctioned_cost", text: "x", value: "364.29 crore", citations: [{ docId: "t", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89" }], origin: "official_record" },
      reader,
      "x",
    );
    expect(wrong.claim.verification).toBe("partially_verified");
  });
  it("does not accept a number that only appears inside another number", () => {
    const r = verifyClaim(
      {
        field: "sanctioned_cost",
        text: "x",
        value: "64.29 lakh",
        citations: [
          { docId: "t", page: 1, quote: "364.29 152.84 4.250 0.000 4.250 268.89" },
          { docId: "t", page: 1, quote: "Note : All Costs are in Lakhs" },
        ],
        origin: "official_record",
      },
      reader,
      "x",
    );
    expect(r.claim.verification).toBe("partially_verified");
  });
  it("parses hyphenated durations", () => {
    expect(valueSupported("5 years", "covered by 5-year maintenance contracts")).toBe(true);
  });
});

describe("user uploads", () => {
  it("caps claims backed only by a reporter's upload at partially verified", () => {
    const upload: CorpusReader = {
      getDocument: (id) => (id === "up-1" ? { ...doc, id: "up-1", sourceType: "user_upload", publisher: "Uploaded by the reporter" } : undefined),
      getPage: (id, p) => (id === "up-1" && p === 1 ? "The work was completed on 12.01.2025 by M/s Example Builders." : undefined),
      pageCount: () => 1,
    };
    const r = verifyClaim(
      { field: "completion_date", text: "Completed on 12 Jan 2025", value: "12.01.2025", citations: [{ docId: "up-1", page: 1, quote: "The work was completed on 12.01.2025" }], origin: "official_record" },
      upload,
      "x",
    );
    expect(r.claim.verification).toBe("partially_verified");
    expect(r.evidence[0].checkNote).toMatch(/authenticity is not checked/);
  });
});

describe("normalising model proposals", () => {
  it("keeps a financial completion date out of the works' completion date, and drops restated reports", async () => {
    const { normaliseProposals } = await import("@/lib/agent/finalize");
    const claim = (field: Claim["field"], value: string, text = value): Claim => ({ id: value, field, value, text, evidenceIds: [], verification: "verified", confidence: 0.9, origin: "official_record" });
    const out = normaliseProposals([
      claim("completion_date", "05-03-2022 (Physical)"),
      claim("completion_date", "27-05-2024 (Financial)"),
      { ...claim("reported_condition", "Several potholes"), origin: "user_report", verification: "unverified" },
    ]);
    expect(out.map((c) => c.field)).toEqual(["completion_date", "other"]);
  });
});
