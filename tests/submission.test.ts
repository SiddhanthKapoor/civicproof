import { describe, expect, it } from "vitest";
import { UNVERIFIED_CHANNEL, isOfficialGovernmentUrl, nextSteps, submissionDestination } from "@/lib/submission";
import { getCorpus } from "@/lib/corpus";
import type { Authority } from "@/lib/corpus";
import type { TimelineEvent } from "@/lib/schemas";

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

/**
 * WHAT TO DO NEXT. The six steps are fixed wording, so what is worth testing is the part that is
 * not: whether a step is shown as done. Only the case's own timeline may do that. CivicProof does
 * not submit anything, so a step it has no record of must read as still to do.
 */
describe("the six steps a citizen takes with a finished packet", () => {
  const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
    id: `t_${Math.random().toString(36).slice(2)}`,
    at: "2026-09-19T10:00:00.000Z",
    type: "note",
    actor: "reporter",
    summary: "s",
    ...over,
  });
  const steps = (over: Partial<Parameters<typeof nextSteps>[0]> = {}) =>
    nextSteps({ caseId: "CP-2026-0007", timeline: [], status: "case_prepared", ...over });

  it("always gives the same six steps, in the order they are carried out", () => {
    const s = steps();
    expect(s.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.map((x) => x.title)).toEqual([
      "Review the evidence",
      "Open the official submission channel",
      "Submit the complaint and evidence",
      "Record the official complaint or reference number in CivicProof",
      "Add authority responses or follow-up photographs",
      "Track the case until an outcome is documented",
    ]);
    expect(s[2].href).toBe("/cases/CP-2026-0007/packet?kind=complaint");
  });

  it("marks nothing as done on a case that has recorded nothing", () => {
    // CivicProof never submits, so it can never be the reason a step is complete.
    expect(steps().every((x) => x.recorded === undefined)).toBe(true);
  });

  it("links the official channel only when it is a verified government URL", () => {
    const linked = steps({ destination: { verified: true, channel: "BBMP Sahaaya", url: "https://gba.karnataka.gov.in/grievance" } });
    expect(linked[1].channel).toEqual({ label: "BBMP Sahaaya", url: "https://gba.karnataka.gov.in/grievance" });
    expect(linked[1].note).toBeUndefined();

    // A destination the directory could not vouch for, and a look-alike domain, both fall back.
    for (const destination of [
      undefined,
      { verified: false } as const,
      { verified: true, channel: "Civic complaints", url: "https://bbmp-grievance.example.com" },
    ]) {
      const s = steps({ destination });
      expect(s[1].channel).toBeUndefined();
      expect(s[1].note).toBe(UNVERIFIED_CHANNEL);
    }
  });

  it("shows submission as done from the reporter's own record, dated when it happened", () => {
    const s = steps({
      timeline: [event({ type: "complaint_submitted", at: "2026-09-25T06:00:00.000Z", date: "2026-09-19", channel: "BBMP Sahaaya" })],
    });
    // The date the complaint was filed, not the day the reporter came back to record it.
    expect(s[2].recorded).toBe("Submission recorded on 19 Sept 2026 through BBMP Sahaaya.");
    // A submission without a reference number does not complete the step that asks for one.
    expect(s[3].recorded).toBeUndefined();
  });

  it("separates having submitted from having a reference number to follow it up with", () => {
    const s = steps({
      timeline: [event({ type: "complaint_submitted", date: "2026-09-19", referenceNumber: "BBMP/2026/44812" })],
    });
    expect(s[2].recorded).toMatch(/^Submission recorded on 19 Sept 2026\.$/);
    expect(s[3].recorded).toBe("Reference BBMP/2026/44812 recorded.");
  });

  it("counts authority replies and follow-up documents, and names them separately", () => {
    const s = steps({
      timeline: [
        event({ type: "response_received", date: "2026-10-02" }),
        event({ type: "evidence_added", date: "2026-10-20" }),
        event({ type: "evidence_added", date: "2026-10-21" }),
      ],
    });
    expect(s[4].recorded).toBe("1 authority response and 2 follow-up documents recorded.");
  });

  it("closes the last step only on a documented outcome", () => {
    expect(steps({ status: "awaiting_response" })[5].recorded).toBeUndefined();
    expect(steps({ status: "resolved" })[5].recorded).toBe("Case recorded as resolved.");
    expect(steps({ status: "closed" })[5].recorded).toBe("Case recorded as closed.");
  });

  it("never tells a citizen that CivicProof will file it, or offers to pass a human check", () => {
    const text = steps().flatMap((s) => [s.title, s.detail, s.note ?? ""]).join(" ");
    expect(text).toMatch(/does not submit on your behalf/);
    expect(text).toMatch(/does not complete any sign-in, consent or CAPTCHA step for you/);
    expect(text).not.toMatch(/\bwe will submit\b|\bCivicProof will file\b|\bautomatically submit/i);
    expect(text).not.toMatch(/\bat fault\b|\bliable\b|\bnegligen|\bcaused\b/i);
  });
});
