/**
 * Scanned uploads go through Amazon Textract (DetectDocumentText) when OCR is enabled. Tested against
 * a local stand-in that speaks Textract's JSON 1.1 protocol.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const targets: string[] = [];
let server: http.Server;

function png(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 200)])));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      targets.push(String(req.headers["x-amz-target"]));
      res.writeHead(200, { "content-type": "application/x-amz-json-1.1" });
      res.end(
        JSON.stringify({
          DocumentMetadata: { Pages: 1 },
          Blocks: [
            { BlockType: "PAGE", Page: 1 },
            { BlockType: "LINE", Page: 1, Text: "Office of the Executive Engineer, PMGSY" },
            { BlockType: "LINE", Page: 1, Text: "The work KN03-63 was completed on 22-04-2022." },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-ocr-")));
  vi.stubEnv("CIVICPROOF_OCR", "textract");
  vi.stubEnv("TEXTRACT_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("OCR of scanned uploads", () => {
  it("reads a scanned image with Textract and makes it quotable", async () => {
    const { createCase, addCaseDocument, readCaseDocumentPages } = await import("@/lib/cases");
    const { caseData, ownerKey } = await createCase(
      { title: "OCR check on Hebbagodi road", description: "Checking OCR of a scanned RTI reply.", category: "pothole", lat: 12.826842, lng: 77.617364, locationSource: "map_pin", observedOn: "2026-09-10" },
      [],
    );
    const { document } = await addCaseDocument(caseData.id, ownerKey, { name: "reply-scan.png", bytes: png() }, { title: "Scanned PIO reply", kind: "rti_reply" });
    expect(targets).toContain("Textract.DetectDocumentText");
    expect(document.ocr).toBe("textract");
    expect(document.textPages).toBe(1);
    expect((await readCaseDocumentPages(document))[0]).toContain("completed on 22-04-2022");
  });
});
