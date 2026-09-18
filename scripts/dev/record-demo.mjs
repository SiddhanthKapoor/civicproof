// Records the demo flow as a video against a running server (with a real model configured):
//   node scripts/dev/record-demo.mjs http://localhost:3100 .demo
// Files a report on the Kodathi–Mullur road (location from simulated device GPS, no photo),
// lets the investigation stream to completion, then walks through the findings and the packets.
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".demo";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const size = { width: 1280, height: 800 };
const ctx = await browser.newContext({
  viewport: size,
  recordVideo: { dir: out, size },
  geolocation: { latitude: 12.894573, longitude: 77.71297 },
  permissions: ["geolocation"],
});
const page = await ctx.newPage();
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${m}`);
const pause = (ms) => page.waitForTimeout(ms);
const glide = async (px, steps = 24) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await pause(40);
  }
};
const show = async (selector) => {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await pause(1600);
};

// 1. Landing page
log("home");
await page.goto(`${base}/`, { waitUntil: "load" });
await pause(3500);
await glide(800);
await pause(2000);
await glide(900);
await pause(2000);

// 2. File a report
log("report form");
await page.goto(`${base}/report`, { waitUntil: "load" });
await pause(1500);
await page.getByRole("radio", { name: "Pothole" }).click();
await page.getByLabel("Title").pressSequentially("Deep potholes on the Kodathi–Mullur road", { delay: 30 });
await page.getByLabel("Description").pressSequentially(
  "Several potholes 30–40 cm across near the Mullur colony turn. Two-wheelers are swerving into oncoming traffic to avoid them.",
  { delay: 12 },
);
await page.getByRole("button", { name: "Use my current location" }).click();
await page.getByText("from your device").first().waitFor({ timeout: 15_000 });
await pause(2500);
await page.getByRole("button", { name: "Create case" }).click();
await page.waitForURL(/\/cases\/CP-/, { timeout: 30_000 });
const caseUrl = page.url().replace(/[?#].*$/, "");
log(`case created ${caseUrl}`);

// 3. The investigation streams live
await pause(2500);
await show("#investigation");
log("investigating…");
// Wait on the run's real status (the page streams it live meanwhile).
const caseId = caseUrl.split("/").pop();
let inv;
for (const until = Date.now() + 9 * 60_000; Date.now() < until; ) {
  await pause(2000);
  inv = (await (await fetch(`${base}/api/cases/${caseId}`)).json()).case.investigation;
  if (inv && inv.status !== "running") break;
}
log(`investigation ${inv?.status}: ${inv?.claims.length ?? 0} claims, engine ${inv?.engine} ${inv?.model ?? ""}${inv?.error ? ` — ${inv.error}` : ""}`);
if (inv?.status !== "complete") {
  await ctx.close();
  await browser.close();
  process.exit(1);
}
await pause(3000);

// 4. Findings, candidates and next steps
for (const id of ["#investigation", "#evidence", "#chain", "#actions"]) {
  await show(id);
  await pause(2200);
  await glide(500);
  await pause(1500);
}

// 5. Packets
log("complaint packet");
await page.goto(`${caseUrl}/packet?kind=complaint`, { waitUntil: "load" });
await pause(3000);
await glide(1400, 40);
await pause(2500);
await glide(1400, 40);
await pause(2500);
log("RTI draft");
await page.getByRole("tab", { name: "RTI draft" }).click();
await pause(3500);
await glide(700);
await pause(3000);

const video = page.video();
await ctx.close();
await browser.close();
const raw = await video.path();
const final = path.join(out, `civicproof-demo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`);
renameSync(raw, final);
log(`saved ${final} (${(statSync(final).size / 1e6).toFixed(1)} MB)`);
for (const f of readdirSync(out)) if (f.endsWith(".webm") && !final.endsWith(f)) console.log("  other recording:", f);
