import { describe, expect, it } from "vitest";
import { rtiClock } from "@/lib/rti-clock";
import type { TimelineEvent } from "@/lib/schemas";

const submitted: TimelineEvent = { id: "e1", at: "2026-08-01T10:00:00.000Z", type: "complaint_submitted", actor: "reporter", summary: "RTI", packet: "rti", date: "2026-08-01", channel: "RTI Online" };

describe("rtiClock", () => {
  it("counts 30 days for the reply and 30 more for the first appeal", () => {
    const c = rtiClock([submitted], "2026-08-15")!;
    expect(c.replyDue).toBe("2026-08-31");
    expect(c.appealBy).toBe("2026-09-30");
    expect(c.state).toBe("waiting");
    expect(c.daysLeft).toBe(16);
  });
  it("is overdue after the reply date with no response", () => {
    expect(rtiClock([submitted], "2026-09-10")!.state).toBe("overdue");
    expect(rtiClock([submitted], "2026-10-05")!.state).toBe("appeal_window_closed");
  });
  it("stops when a response is recorded", () => {
    const reply: TimelineEvent = { id: "e2", at: "2026-08-20T10:00:00.000Z", type: "response_received", actor: "reporter", summary: "reply" };
    expect(rtiClock([submitted, reply], "2026-09-10")!.state).toBe("replied");
  });
  it("counts the appeal window from the date the reply was received", () => {
    const reply: TimelineEvent = { id: "e2", at: "2026-08-20T10:00:00.000Z", type: "response_received", actor: "reporter", summary: "reply", date: "2026-08-18" };
    const c = rtiClock([submitted, reply], "2026-09-10")!;
    expect(c.repliedOn).toBe("2026-08-18");
    expect(c.appealBy).toBe("2026-09-17");
    expect(c.daysLeft).toBe(7);
  });
  it("ignores complaint submissions", () => {
    expect(rtiClock([{ ...submitted, packet: "complaint" }], "2026-09-10")).toBeUndefined();
  });
});
