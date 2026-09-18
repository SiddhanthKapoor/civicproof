import { addCaseDocument, DocumentMetaSchema, ForbiddenError } from "@/lib/cases";
import { toPublicCase } from "@/lib/schemas";
import { clientIp, handle, json, ownerKeyFrom, problem, rateLimited } from "@/lib/http";

export const runtime = "nodejs";

/** Reporter adds a document (e.g. an RTI reply). Owner only; the file stays private. */
export const POST = handle("cases.documents.add", async (req: Request, ctx: RouteContext<"/api/cases/[id]/documents">) => {
  const { id } = await ctx.params;
  if (rateLimited(`doc:${clientIp(req)}`, 20, 60 * 60 * 1000)) return problem(429, "Too many uploads in the last hour.");
  if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) return problem(413, "Documents must be under 5 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || file.size === 0) return problem(400, "Choose a file.", { fields: { file: "Choose a PDF or an image." } });
  const meta = DocumentMetaSchema.parse({ title: form.get("title"), kind: form.get("kind") });
  try {
    const { caseData, document } = await addCaseDocument(id, ownerKeyFrom(req), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, meta);
    return json({ case: toPublicCase(caseData), document }, 201);
  } catch (e) {
    if (e instanceof ForbiddenError) return problem(403, e.message);
    throw e;
  }
});
