import { describe, expect, it } from "vitest";
import { UNVERIFIED_CHANNEL, isOfficialGovernmentUrl, submissionDestination } from "@/lib/submission";
import { getCorpus } from "@/lib/corpus";
import type { Authority } from "@/lib/corpus";

/**
 * Where a packet is taken. The rule under test is narrow on purpose: a destination is reported
 * only when the directory holds a government URL for it. Sending a citizen's complaint to a
 * guessed address is worse than telling them to find the channel themselves.
 */
describe("only a government channel counts as a verified destination", () => {
  it("accepts https on a gov.in or nic.in host, and nothing else", () => {
    expect(isOfficialGovernmentUrl("https://pgportal.gov.in")).toBe(true);
    expect(isOfficialGovernmentUrl("https://gba.karnataka.gov.in")).toBe(true);
    expect(isOfficialGovernmentUrl("https://rtionline.karnataka.gov.in/index.php?lan=E")).toBe(true);
    expect(isOfficialGovernmentUrl("https://example.nic.in/grievance")).toBe(true);
  });

  it("refuses look-alikes, plain http, and anything unparseable", () => {
    expect(isOfficialGovernmentUrl("https://bbmp-grievance.com")).toBe(false);
    expect(isOfficialGovernmentUrl("https://gov.in.example.com")).toBe(false); // host merely contains it
    expect(isOfficialGovernmentUrl("http://pgportal.gov.in")).toBe(false); // not over TLS
    expect(isOfficialGovernmentUrl("not a url")).toBe(false);
    expect(isOfficialGovernmentUrl(undefined)).toBe(false);
  });
});

describe("the destination for a Bengaluru case", () => {
  const corpus = getCorpus();

  it("names BBMP's own portal for a city complaint, and carries its caveat", () => {
    const d = submissionDestination("complaint", corpus.getAuthority("bbmp"));
    expect(d.verified).toBe(true);
    expect(d.authority).toMatch(/Bruhat Bengaluru Mahanagara Palike/);
    expect(isOfficialGovernmentUrl(d.url)).toBe(true);
    expect(d.method).toMatch(/complete any CAPTCHA or other check yourself/);
    // The directory records that the Sahaaya sites did not answer; the caveat travels with it.
    expect(d.note).toMatch(/failed TLS checks|confirm the current channel/i);
  });

  it("routes a PMGSY complaint to CPGRAMS and an RTI to the state portal", () => {
    const grievance = submissionDestination("complaint", corpus.getAuthority("pmgsy-dpiu-bengaluru-urban"));
    expect(grievance.channel).toMatch(/CPGRAMS/);
    expect(isOfficialGovernmentUrl(grievance.url)).toBe(true);

    const rti = submissionDestination("rti", corpus.getAuthority("pmgsy-dpiu-bengaluru-urban"));
    expect(rti.channel).toMatch(/RTI Online/);
    expect(isOfficialGovernmentUrl(rti.url)).toBe(true);
    expect(rti.method).toMatch(/pay the fee/);
  });

  it("reports nothing when there is no authority to report", () => {
    expect(submissionDestination("complaint", undefined)).toEqual({ verified: false });
    expect(UNVERIFIED_CHANNEL).toMatch(/Submission channel not verified/);
  });

  it("refuses a channel that is not on a government domain rather than offering it", () => {
    const impostor = { ...corpus.getAuthority("bbmp")!, grievance: { name: "Civic complaints", url: "https://bbmp-grievances.example.com" } } as Authority;
    const d = submissionDestination("complaint", impostor);
    expect(d.verified).toBe(false);
    expect(d.url).toBeUndefined();
  });

  it("still names a real route when an authority has no online RTI portal", () => {
    // Filing on paper is a genuine channel; it is reported as one, not as a failure.
    const postal = { ...corpus.getAuthority("bbmp")!, rti: { addressee: "The Public Information Officer, BBMP" } } as Authority;
    const d = submissionDestination("rti", postal);
    expect(d.verified).toBe(true);
    expect(d.url).toBeUndefined();
    expect(d.method).toMatch(/By post or in person/);
  });

  it("every channel the directory holds is on a government domain", () => {
    // A guessed or commercial address must never reach the directory in the first place.
    for (const a of corpus.authorities) {
      if (a.grievance?.url) expect(isOfficialGovernmentUrl(a.grievance.url), `${a.id} grievance`).toBe(true);
      if (a.rti?.portalUrl) expect(isOfficialGovernmentUrl(a.rti.portalUrl), `${a.id} rti`).toBe(true);
    }
  });
});
