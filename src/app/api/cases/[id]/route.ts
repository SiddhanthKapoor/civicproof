import { getStore } from "@/lib/store";
import { toPublicCase } from "@/lib/schemas";
import { handle, json, ownerKeyFrom, problem } from "@/lib/http";
import { ownerKeyMatches } from "@/lib/ids";

export const runtime = "nodejs";

export const GET = handle("cases.get", async (req: Request, ctx: RouteContext<"/api/cases/[id]">) => {
  const { id } = await ctx.params;
  const c = await getStore().get(id);
  if (!c) return problem(404, "Case not found.");
  const key = ownerKeyFrom(req);
  return json(
    { case: toPublicCase(c), isOwner: key ? ownerKeyMatches(key, c.ownerKeyHash) : false },
    { headers: { "cache-control": "no-store" } },
  );
});
