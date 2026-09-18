import { expect, test } from "@playwright/test";
import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import zlib from "node:zlib";

/** A small valid PNG so the upload path (sniffing, hashing, storage) is exercised for real. */
function png(w: number, h: number): Buffer {
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 140)])));
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("report → case → live investigation → packet", async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), "cp-e2e-"));
  const photo = path.join(dir, "road.png");
  writeFileSync(photo, png(320, 240));

  await page.goto("/report");
  await expect(page.getByRole("heading", { name: /Report what you saw/ })).toBeVisible();

  // Validation: submitting empty shows field errors instead of sending.
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByText("Give the report a short, specific title")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(photo);
  await expect(page.getByRole("img", { name: /Selected photo/ })).toBeVisible();

  await page.getByRole("radio", { name: "Pothole" }).click();
  await page.getByLabel("Title").fill("Potholes near the Mullur colony turn");
  await page.getByLabel("Description").fill("Three deep potholes across the lane near the colony turn; bikes are swerving around them.");

  // Place the pin by clicking the map (the map starts centred on Bengaluru; the test then sets it exactly).
  const map = page.getByRole("region", { name: "Choose the location of the issue" });
  await expect(map.locator("canvas")).toBeVisible({ timeout: 20_000 });
  await map.click({ position: { x: 200, y: 150 } });
  await expect(page.getByText(/placed on map/)).toBeVisible();

  await page.getByRole("button", { name: "Create case" }).click();
  await page.waitForURL(/\/cases\/CP-/);
  await expect(page.getByText("Case created. Keep your owner key.")).toBeVisible();
  // The investigation starts on its own and finishes (rules planner locally).
  await expect(page.getByText(/Agent run|Agent running/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "What to do next" })).toBeVisible();

  const caseUrl = page.url();
  await page.goto(caseUrl.replace(/[?#].*$/, "") + "/packet?kind=rti");
  await expect(page.getByRole("heading", { name: "RTI application" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue(/Section 6\(1\)/);
});

test("pages render without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const p of ["/", "/cases", "/sources", "/how-it-works", "/report"]) {
    await page.goto(p);
    await expect(page.locator("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
