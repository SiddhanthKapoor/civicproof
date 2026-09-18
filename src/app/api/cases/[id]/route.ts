import { getStore } from "@/lib/store";
import { settleStaleRun } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { handle, json, ownerKeyFrom, problem } from "@/lib/http";
import { ownerKeyMatches } from "@/lib/ids";

export const runtime = "nodejs";

export const GET = handle("cases.get", async (req: Request, ctx: RouteContext<"/api/cases/[id]">) => {
  const { id } = await ctx.params;
  const stored = await getStore().get(id);
  if (!stored) return problem(404, "Case not found.");
  const c = settleStaleRun(stored);
  const key = ownerKeyFrom(req);
  return json(
    { case: toPublicCase(c), isOwner: key ? ownerKeyMatches(key, c.ownerKeyHash) : false },
    { headers: { "cache-control": "no-store" } },
  );
});
