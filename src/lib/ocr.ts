/**
 * OCR for scanned documents with Amazon Textract (text detection).
 *   - images and single-page PDFs: DetectDocumentText (synchronous, bytes)
 *   - multi-page PDFs: StartDocumentTextDetection on the S3 object, then GetDocumentTextDetection
 * Returns one string per page (LINE blocks in reading order), or null when OCR is off.
 */
import "server-only";
import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import { config } from "@/lib/config";
import { log } from "@/lib/log";

let client: TextractClient | undefined;
function textract() {
  client ??= new TextractClient({
    region: config.region,
    ...(config.textractEndpoint ? { endpoint: config.textractEndpoint, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}),
  });
  return client;
}

function pagesFromBlocks(blocks: Block[]): string[] {
  const pages: string[][] = [];
  for (const b of blocks) {
    if (b.BlockType !== "LINE" || !b.Text) continue;
    const p = (b.Page ?? 1) - 1;
    (pages[p] ??= []).push(b.Text);
  }
  return Array.from({ length: pages.length }, (_, i) => (pages[i] ?? []).join("\n"));
}

export function ocrEnabled() {
  return config.ocr === "textract";
}

export async function ocrPages(input: { bytes: Uint8Array; pageCount: number; s3Key?: string }): Promise<string[] | null> {
  if (!ocrEnabled()) return null;
  const started = Date.now();
  if (input.pageCount <= 1 || !input.s3Key || !config.bucket) {
    const res = await textract().send(new DetectDocumentTextCommand({ Document: { Bytes: input.bytes } }));
    const pages = pagesFromBlocks(res.Blocks ?? []);
    log.info("ocr.sync", { pages: pages.length, ms: Date.now() - started });
    return pages;
  }
  const { JobId } = await textract().send(
    new StartDocumentTextDetectionCommand({ DocumentLocation: { S3Object: { Bucket: config.bucket, Name: input.s3Key } } }),
  );
  const blocks: Block[] = [];
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2000));
    let next: string | undefined;
    let status: string | undefined;
    do {
      const page = await textract().send(new GetDocumentTextDetectionCommand({ JobId, NextToken: next }));
      status = page.JobStatus;
      if (status !== "SUCCEEDED") break;
      blocks.push(...(page.Blocks ?? []));
      next = page.NextToken;
    } while (next);
    if (status === "SUCCEEDED") {
      const pages = pagesFromBlocks(blocks);
      log.info("ocr.async", { pages: pages.length, ms: Date.now() - started });
      return pages;
    }
    if (status === "FAILED") throw new Error("Textract could not read the document");
  }
  throw new Error("Textract did not finish in time");
}
