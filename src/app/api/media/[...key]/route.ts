import { getBlobs, isSafeKey } from "@/lib/blob";
import { handle, problem } from "@/lib/http";

export const runtime = "nodejs";

/** Streams a stored photo from S3 (or local disk). Keys are content-addressed, so responses are immutable. */
export const GET = handle("media.get", async (_req: Request, ctx: RouteContext<"/api/media/[...key]">) => {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!isSafeKey(key) || !key.startsWith("photos/")) return problem(404, "Not found.");
  const blob = await getBlobs().get(key);
  if (!blob) return problem(404, "Not found.");
  return new Response(Buffer.from(blob.body), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
});
