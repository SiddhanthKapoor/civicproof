/**
 * Starts an investigation and streams its progress as NDJSON (one JSON event per line).
 * On AWS this runs behind a Lambda Function URL in RESPONSE_STREAM mode, so the browser sees
 * each tool call, Cedar decision and verified claim as it happens.
 */
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";
import { runInProgress } from "@/lib/cases";
import { authorize } from "@/lib/authz";
import { runInvestigation, type StreamEvent } from "@/lib/agent/run";
import { toPublicCase } from "@/lib/schemas";
import { clientIp, handle, problem, rateLimited } from "@/lib/http";
import { errorMessage, log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = handle("cases.investigate", async (req: Request, ctx: RouteContext<"/api/cases/[id]/investigate">) => {
  const { id } = await ctx.params;
  const store = getStore();
  const c = await store.get(id);
  if (!c) return problem(404, "Case not found.");

  if (runInProgress(c)) {
    return problem(409, "An investigation is already running for this case. Refresh in a moment to see it.");
  }
  if (rateLimited(`investigate:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
    return problem(429, "Too many investigations from this connection in the last hour.");
  }

  const runsForCase = c.timeline.filter((e) => e.type === "investigation_started").length;
  const today = new Date().toISOString().slice(0, 10);
  const runsToday = (await store.increment(`runs:${config.planner}:${today}`, 3 * 86400)) - 1;
  const decision = authorize({ type: "Public", id: "anonymous" }, "StartInvestigation", id, {
    runs_for_case: runsForCase,
    max_runs_per_case: config.maxInvestigationsPerCase,
    runs_today: runsToday,
    max_runs_per_day: config.maxInvestigationsPerDay,
  });
  if (!decision.allowed) {
    log.warn("investigation.denied", { caseId: id, runsForCase, runsToday });
    return problem(429, runsForCase >= config.maxInvestigationsPerCase
      ? `This case has already been investigated ${runsForCase} times, the limit per case.`
      : "Today's investigation budget is used up. Please try again tomorrow.", { policy: "investigate-within-budget" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: StreamEvent) => {
        if (!open) return;
        const payload = e.type === "complete" ? { type: "complete", case: toPublicCase(e.caseData) } : e;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        } catch {
          open = false; // client went away; the run continues and is persisted
        }
      };
      try {
        await runInvestigation(id, send);
      } catch (e) {
        send({ type: "failed", error: errorMessage(e) });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
