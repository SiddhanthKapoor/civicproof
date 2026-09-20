import { ForbiddenError, InvalidInputError, recordTimeline, TimelineInputSchema } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { handle, json, ownerKeyFrom, problem } from "@/lib/http";

export const runtime = "nodejs";

export const POST = handle("cases.timeline", async (req: Request, ctx: RouteContext<"/api/cases/[id]/timeline">) => {
  const { id } = await ctx.params;
  const input = TimelineInputSchema.parse(await req.json());
  try {
    const updated = await recordTimeline(id, ownerKeyFrom(req), input);
    return json({ case: toPublicCase(updated) });
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(403, e.message, { policies: e.policies });
    if (e instanceof InvalidInputError) return problem(400, e.message, { fields: e.fields });
    throw e;
  }
});
