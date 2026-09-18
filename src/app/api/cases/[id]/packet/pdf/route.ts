import { z } from "zod";
import { PacketKindSchema } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { getBlobs } from "@/lib/blob";
import { draftPacket, ForbiddenError, PacketEditSchema } from "@/lib/cases";
import { renderPacketPdf } from "@/lib/pdf";
import { ownerKeyMatches, sha256Hex } from "@/lib/ids";
import { clientIp, handle, ownerKeyFrom, problem, rateLimited } from "@/lib/http";
import { log } from "@/lib/log";
import type { Packet } from "@/lib/schemas";

export const runtime = "nodejs";

const Body = z.object({ kind: PacketKindSchema, edit: PacketEditSchema.optional() });

/**
 * Renders the packet (including unsaved edits sent by the browser) to PDF. For the reporter the
 * base is their saved packet and the file is archived to S3 under packets/<case>/, so every PDF
 * they took away is retained. Anyone else gets a PDF of the public draft and nothing is stored.
 */
export const POST = handle("cases.packet.pdf", async (req: Request, ctx: RouteContext<"/api/cases/[id]/packet/pdf">) => {
  const { id } = await ctx.params;
  if (rateLimited(`pdf:${clientIp(req)}`, 40, 60 * 60 * 1000)) return problem(429, "Too many PDFs from this connection in the last hour.");
  const body = Body.parse(await req.json());
  const c = await getStore().get(id);
  if (!c) return problem(404, "Case not found.");

  const isOwner = ownerKeyMatches(ownerKeyFrom(req), c.ownerKeyHash);
  let base: Packet;
  try {
    base = isOwner ? (c.packets[body.kind] ?? draftPacket(c, body.kind, { forOwner: true })) : draftPacket(c, body.kind);
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(409, e.message);
    throw e;
  }
  const packet: Packet = body.edit ? { ...base, addressedTo: body.edit.addressedTo, subject: body.edit.subject, sections: body.edit.sections } : base;
  const pdf = await renderPacketPdf(packet, c.id);
  const hash = sha256Hex(pdf);
  const key = isOwner ? `packets/${c.id.toLowerCase()}/${body.kind}-${hash.slice(0, 16)}.pdf` : undefined;
  if (key) {
    try {
      await getBlobs().put(key, new Uint8Array(pdf), "application/pdf");
    } catch (e) {
      log.warn("packet.archive_failed", { caseId: c.id, error: String(e) });
    }
  }
  log.info("packet.pdf", { caseId: c.id, kind: body.kind, bytes: pdf.byteLength, key });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="civicproof-${c.id.toLowerCase()}-${body.kind}.pdf"`,
      "x-civicproof-sha256": hash,
      "cache-control": "no-store",
    },
  });
});
