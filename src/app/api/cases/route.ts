import { z } from "zod";
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";
import { createCase, PhotoMetaSchema, sniffImage } from "@/lib/cases";
import { NewReportSchema } from "@/lib/schemas";
import { clientIp, handle, json, problem, rateLimited } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle("cases.list", async () => {
  const cases = await getStore().list(300);
  return json({ cases }, { headers: { "cache-control": "no-store" } });
});

const MAX_BODY = 6 * 1024 * 1024; // Lambda Function URL request payload limit

export const POST = handle("cases.create", async (req: Request) => {
  if (rateLimited(`create:${clientIp(req)}`, 12, 60 * 60 * 1000)) {
    return problem(429, "Too many reports from this connection in the last hour. Please try again later.");
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return problem(413, "Photos are too large. Try fewer photos (they are resized in your browser before upload).");

  const form = await req.formData();
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  const input = NewReportSchema.parse({
    title: field("title"),
    description: field("description"),
    category: field("category"),
    lat: field("lat"),
    lng: field("lng"),
    locationSource: field("locationSource"),
    address: field("address"),
    observedOn: field("observedOn"),
    reporterName: field("reporterName"),
    reporterContact: field("reporterContact"),
    locationAccuracyM: field("locationAccuracyM"),
    jobCode: field("jobCode"),
  });

  const files = form.getAll("photos").filter((f): f is File => typeof f !== "string");
  if (files.length > config.maxPhotos) return problem(400, `Attach at most ${config.maxPhotos} photos.`, { fields: { photos: `At most ${config.maxPhotos} photos.` } });
  // A chunked upload has no content-length; check what actually arrived.
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BODY) return problem(413, "Photos are too large. Try fewer photos (they are resized in your browser before upload).");
  let rawMeta: unknown;
  try {
    rawMeta = JSON.parse(field("photoMeta") ?? "[]");
  } catch {
    return problem(400, "Photo details could not be read. Please try again.");
  }
  const metas = z.array(PhotoMetaSchema).parse(rawMeta);

  const photos: Array<{ bytes: Uint8Array; meta: z.infer<typeof PhotoMetaSchema> }> = [];
  for (const [i, f] of files.entries()) {
    if (f.size === 0) continue;
    if (f.size > config.maxPhotoBytes) return problem(400, "Each photo must be under 8 MB.", { fields: { photos: "Each photo must be under 8 MB." } });
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!sniffImage(bytes)) {
      return problem(400, "Photos must be JPEG, PNG or WebP images.", { fields: { photos: `"${f.name}" is not a JPEG, PNG or WebP image.` } });
    }
    photos.push({ bytes, meta: metas[i] ?? {} });
  }

  const { caseData, ownerKey } = await createCase(input, photos);
  return json({ id: caseData.id, ownerKey }, 201);
});
