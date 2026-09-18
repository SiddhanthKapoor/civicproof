import { describe, expect, it } from "vitest";
import { runInProgress, settleStaleRun } from "@/lib/cases";
import type { Case } from "@/lib/schemas";

// A run cut off mid-way (server restart, Lambda timeout) stays "running" in the store forever.
const running = (minutesAgo: number) =>
  ({ id: "CP-TEST", investigation: { status: "running", startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() } }) as unknown as Case;

describe("stale investigations", () => {
  it("treats a run long past the time limit as interrupted, so it can be run again", () => {
    expect(runInProgress(running(1))).toBe(true);
    const stale = settleStaleRun(running(30));
    expect(stale.investigation?.status).toBe("failed");
    expect(stale.investigation?.error).toMatch(/stopped before it finished/);
    expect(runInProgress(running(30))).toBe(false);
  });
});
