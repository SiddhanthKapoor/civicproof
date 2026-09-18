import { getStore } from "@/lib/store";
import { readCaseDocumentPages } from "@/lib/cases";
import { authorize } from "@/lib/authz";
import { ownerKeyMatches } from "@/lib/ids";
import { handle, json, ownerKeyFrom, problem } from "@/lib/http";

export const runtime = "nodejs";

/** Page text of a reporter's document. Private: only the reporter (owner key) can read it. */
export const GET = handle("cases.documents.get", async (req: Request, ctx: RouteContext<"/api/cases/[id]/documents/[docId]">) => {
  const { id, docId } = await ctx.params;
  const c = await getStore().get(id);
  const doc = c?.documents.find((d) => d.id === docId);
  if (!c || !doc) return problem(404, "Document not found.");
  const isOwner = ownerKeyMatches(ownerKeyFrom(req), c.ownerKeyHash);
  const d = authorize(isOwner ? { type: "Reporter", id } : { type: "Public", id: "anonymous" }, "ViewPrivateDocument", id, { is_owner: isOwner });
  if (!d.allowed) return problem(403, "Documents are visible only to the person who filed the report. Quoted excerpts appear on the case page.");
  return json({ document: doc, pages: await readCaseDocumentPages(doc) }, { headers: { "cache-control": "private, no-store" } });
});
