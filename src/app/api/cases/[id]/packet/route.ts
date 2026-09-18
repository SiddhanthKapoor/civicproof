import { z } from "zod";
import { PacketKindSchema } from "@/lib/schemas";
import { ForbiddenError, PacketEditSchema, savePacket } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { clientIp, handle, json, ownerKeyFrom, problem, rateLimited } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ kind: PacketKindSchema, edit: PacketEditSchema.optional() });

/** Drafts a complaint, RTI or appeal packet; only the reporter's drafts and edits are saved to the case. */
export const POST = handle("cases.packet", async (req: Request, ctx: RouteContext<"/api/cases/[id]/packet">) => {
  const { id } = await ctx.params;
  if (rateLimited(`packet:${clientIp(req)}`, 60, 60 * 60 * 1000)) return problem(429, "Too many requests. Try again later.");
  const body = Body.parse(await req.json());
  try {
    const r = await savePacket(id, ownerKeyFrom(req), body.kind, body.edit);
    return json({ case: toPublicCase(r.caseData), packet: r.packet, persisted: r.persisted });
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(403, e.message, { policies: e.policies });
    throw e;
  }
});
