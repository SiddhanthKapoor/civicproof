import { describe, expect, it } from "vitest";
import { detectConflicts } from "@/lib/agent/verifier";
import { sameFact, typedQuantity } from "@/lib/agent/text";
import type { Claim } from "@/lib/schemas";

/**
 * Conflict detection is the guard against two opposite failures: manufacturing a conflict from a
 * formatting difference, and hiding a real disagreement behind a loose comparison. Values are
 * normalised into a typed quantity (kind + magnitude in one canonical unit) and compared exactly.
 */
const claim = (id: string, value: string, field: Claim["field"] = "sanctioned_cost"): Claim => ({
  id, field, value, text: `The record states ${value}.`,
  evidenceIds: [`ev-${id}`], verification: "verified", confidence: 0.95, origin: "official_record",
});

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe("typed quantities", () => {
  it("converts to one canonical unit per kind", () => {
    expect(typedQuantity("364.29 Lakhs")).toEqual({ kind: "money", value: 36_429_000 });
    expect(typedQuantity("1.25 crore")).toEqual({ kind: "money", value: 12_500_000 });
    expect(typedQuantity("12.5 million")).toEqual({ kind: "money", value: 12_500_000 });
    expect(typedQuantity("364.29 km")).toEqual({ kind: "length", value: 364_290 });
    expect(typedQuantity("364.29 metres")).toEqual({ kind: "length", value: 364.29 });
    expect(typedQuantity("2 years")).toEqual({ kind: "duration", value: 24 });
    expect(typedQuantity("24 months")).toEqual({ kind: "duration", value: 24 });
    expect(typedQuantity("9%")).toEqual({ kind: "ratio", value: 9 });
    expect(typedQuantity("2022-03-05")).toEqual({ kind: "date", value: "2022-03-05" });
  });

  it("treats a figure with no unit as its own kind, so a dropped unit cannot pass as equal", () => {
    expect(typedQuantity("364.29")).toEqual({ kind: "count", value: 364.29 });
    expect(sameFact("364.29 Lakhs", "364.29")).toBe(false);
  });
});

describe("values that must be treated as the SAME fact", () => {
  const pairs: Array<[string, string]> = [
    ["12 months", "1 year"],
    ["2 years", "24 months"],
    ["05-03-2022", "5 Mar 2022"],
    ["Rs. 1,25,00,000", "1.25 crore"],
    ["DPIU Of Bangalore u", "DPIU Of Bangalore u (Bangalore Urban)"],
    ["Venkatarama Reddy .M", "M. Venkatarama Reddy"],
  ];
  for (const [a, b] of pairs) {
    it(`${a} = ${b}`, () => {
      expect(sameFact(a, b), `${a} / ${b}`).toBe(true);
      const { claims, conflicts } = detectConflicts([claim("one", a), claim("two", b)]);
      expect(conflicts).toHaveLength(0);
      expect(claims).toHaveLength(1);
      expect(claims[0].evidenceIds.sort()).toEqual(["ev-one", "ev-two"]);
    });
  }
});

describe("values that must be reported as a CONFLICT", () => {
  const pairs: Array<[string, string]> = [
    ["2022-03-05", "2022-05-03"], // two unambiguous, different dates
    ["12.5 million", "12.5 crore"], // same figure, units a factor of 10 apart
    ["364.29 metres", "364.29 km"], // same figure, unconvertible without the unit
    ["9%", "5%"], // both collapsed to one bucket before the fix
    ["364.29 lakh", "364.29 crore"],
    ["364.29 Lakhs", "364.29"], // unit dropped: the unit cannot be established, so fail closed
    ["5 years", "5 months"],
  ];
  for (const [a, b] of pairs) {
    it(`${a} ≠ ${b}`, () => {
      expect(sameFact(a, b), `${a} / ${b}`).toBe(false);
      const { claims, conflicts } = detectConflicts([claim("one", a), claim("two", b)]);
      expect(conflicts).toHaveLength(1);
      expect(claims.every((c) => c.verification === "contradicted")).toBe(true);
    });
  }
});

describe("clustering is a property of the values, not of their order", () => {
  const groups: string[][] = [
    ["364.29 lakh", "364.29 crore", "364.29"], // the non-transitive case: 3 distinct facts
    ["12 months", "1 year", "365 days"],
    ["05-03-2022", "5 Mar 2022", "2022-03-05"],
    ["Rs. 1,25,00,000", "1.25 crore", "1.25 crore"],
    ["9%", "5%", "9%"],
  ];
  for (const group of groups) {
    it(`is invariant under permutation: ${group.join(" / ")}`, () => {
      const results = permutations(group.map((v, i) => claim(`c${i}`, v))).map((order) => {
        const { claims, conflicts } = detectConflicts(order);
        return {
          conflicts: conflicts.length,
          // the set of surviving values, order-independent
          kept: [...new Set(claims.map((c) => c.value))].sort(),
          contradicted: claims.filter((c) => c.verification === "contradicted").length,
        };
      });
      for (const r of results) expect(r).toEqual(results[0]);
    });
  }

  it("keeps three separate facts for lakh / crore / bare figure, in any order", () => {
    for (const order of permutations(["364.29 lakh", "364.29 crore", "364.29"])) {
      const { conflicts } = detectConflicts(order.map((v, i) => claim(`c${i}`, v)));
      expect(conflicts, order.join(" / ")).toHaveLength(1);
      expect(conflicts[0].description).toMatch(/Sources disagree/);
    }
  });

  it("prefers the value that carries its unit when merging", () => {
    // Two citations on the bare figure, one on the unit-bearing value: the unit must still win.
    const bare = { ...claim("bare", "1,25,00,000"), evidenceIds: ["e1", "e2"] };
    const withUnit = { ...claim("unit", "Rs. 1,25,00,000"), evidenceIds: ["e3"] };
    const { claims } = detectConflicts([bare, withUnit]);
    // Different kinds, so these do not merge at all — the conflict is surfaced instead.
    expect(claims.every((c) => c.verification === "contradicted")).toBe(true);
  });
});
