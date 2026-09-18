import { getStore } from "@/lib/store";
import { getBlobs } from "@/lib/blob";
import { ownerKeyMatches } from "@/lib/ids";
import { handle, problem } from "@/lib/http";

export const runtime = "nodejs";

/** Downloads the original file (owner key in the x-owner-key header; never in the URL). */
export const GET = handle("cases.documents.file", async (req: Request, ctx: RouteContext<"/api/cases/[id]/documents/[docId]/file">) => {
  const { id, docId } = await ctx.params;
  const key = req.headers.get("x-owner-key");
  const c = await getStore().get(id);
  const doc = c?.documents.find((d) => d.id === docId);
  if (!c || !doc) return problem(404, "Document not found.");
  if (!ownerKeyMatches(key, c.ownerKeyHash)) return problem(403, "Only the reporter can download this document.");
  const blob = await getBlobs().get(doc.key);
  if (!blob) return problem(404, "File missing.");
  return new Response(Buffer.from(blob.body), {
    headers: {
      "content-type": doc.mime,
      "content-disposition": `inline; filename="${doc.filename.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
});
