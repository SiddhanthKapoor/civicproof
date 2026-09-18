import { z } from "zod";
import { PacketKindSchema } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { getBlobs } from "@/lib/blob";
import { draftPacket, ForbiddenError, PacketEditSchema } from "@/lib/cases";
import { renderPacketPdf } from "@/lib/pdf";
import { sha256Hex } from "@/lib/ids";
import { clientIp, handle, problem, rateLimited } from "@/lib/http";
import { log } from "@/lib/log";
import type { Packet } from "@/lib/schemas";

export const runtime = "nodejs";

const Body = z.object({ kind: PacketKindSchema, edit: PacketEditSchema.optional() });

/**
 * Renders the packet (including unsaved edits sent by the browser) to PDF. The rendered file
 * is also archived to S3 under packets/<case>/ so every PDF that left CivicProof is retained.
 */
export const POST = handle("cases.packet.pdf", async (req: Request, ctx: RouteContext<"/api/cases/[id]/packet/pdf">) => {
  const { id } = await ctx.params;
  if (rateLimited(`pdf:${clientIp(req)}`, 40, 60 * 60 * 1000)) return problem(429, "Too many PDFs from this connection in the last hour.");
  const body = Body.parse(await req.json());
  const c = await getStore().get(id);
  if (!c) return problem(404, "Case not found.");

  let base: Packet;
  try {
    base = c.packets[body.kind] ?? draftPacket(c, body.kind);
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(409, e.message);
    throw e;
  }
  const packet: Packet = body.edit ? { ...base, addressedTo: body.edit.addressedTo, subject: body.edit.subject, sections: body.edit.sections } : base;
  const pdf = await renderPacketPdf(packet, c.id);
  const hash = sha256Hex(pdf);
  const key = `packets/${c.id.toLowerCase()}/${body.kind}-${hash.slice(0, 16)}.pdf`;
  try {
    await getBlobs().put(key, new Uint8Array(pdf), "application/pdf");
  } catch (e) {
    log.warn("packet.archive_failed", { caseId: c.id, error: String(e) });
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
