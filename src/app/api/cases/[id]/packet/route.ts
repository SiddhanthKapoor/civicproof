import { z } from "zod";
import { ForbiddenError, PacketEditSchema, savePacket } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { handle, json, ownerKeyFrom, problem } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ kind: z.enum(["complaint", "rti"]), edit: PacketEditSchema.optional() });

/** Drafts (or, for the owner, saves an edited) complaint or RTI packet. */
export const POST = handle("cases.packet", async (req: Request, ctx: RouteContext<"/api/cases/[id]/packet">) => {
  const { id } = await ctx.params;
  const body = Body.parse(await req.json());
  try {
    const updated = await savePacket(id, ownerKeyFrom(req), body.kind, body.edit);
    return json({ case: toPublicCase(updated) });
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(403, e.message, { policies: e.policies });
    throw e;
  }
});
