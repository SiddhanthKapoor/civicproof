/**
 * Binary storage for report photos and generated packet PDFs.
 * Local: files under .data/blobs.  AWS: a private S3 bucket (SSE-S3, public access blocked);
 * objects are streamed back through /api/media so the bucket is never exposed.
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "@/lib/config";

export interface BlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
}

/** Keys are generated server-side; this guards the media route against traversal anyway. */
export function isSafeKey(key: string): boolean {
  return /^[a-z0-9][a-z0-9/_.-]{3,200}$/i.test(key) && !key.includes("..") && !key.startsWith("/");
}

class LocalBlobStore implements BlobStore {
  constructor(private root: string) {}

  private file(key: string) {
    if (!isSafeKey(key)) throw new Error("Invalid key");
    return path.join(this.root, key);
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
    await fs.writeFile(`${f}.meta`, JSON.stringify({ contentType }));
  }

  async get(key: string) {
    try {
      const f = this.file(key);
      const [body, meta] = await Promise.all([fs.readFile(f), fs.readFile(`${f}.meta`, "utf8")]);
      return { body: new Uint8Array(body), contentType: JSON.parse(meta).contentType as string };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}

class S3BlobStore implements BlobStore {
  private s3 = new S3Client({ region: config.region });
  constructor(private bucket: string) {}

  async put(key: string, body: Uint8Array, contentType: string) {
    if (!isSafeKey(key)) throw new Error("Invalid key");
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string) {
    if (!isSafeKey(key)) return null;
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await res.Body!.transformToByteArray();
      return { body, contentType: res.ContentType ?? "application/octet-stream" };
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }
}

let instance: BlobStore | undefined;

export function getBlobs(): BlobStore {
  if (!instance) {
    if (config.blobs === "s3") {
      if (!config.bucket) throw new Error("CIVICPROOF_BUCKET must be set when CIVICPROOF_BLOBS=s3");
      instance = new S3BlobStore(config.bucket);
    } else {
      instance = new LocalBlobStore(path.join(config.dataDir, "blobs"));
    }
  }
  return instance;
}
