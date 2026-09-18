// Usage: node scripts/dev/shot.mjs <url> <outPrefix> [width] [height] [slices] [waitMs]
// Scrolls the page (to trigger in-view animations), then saves viewport-height slices.
import { chromium } from "@playwright/test";
const [url, out, w = "1440", h = "900", slices = "6", wait = "1500"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch((e) => logs.push("goto: " + e.message));
await page.waitForTimeout(+wait);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const files = [];
for (let i = 0; i < +slices && i * +h < total; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * +h);
  await page.waitForTimeout(900);
  const file = `${out}-${i}.png`;
  await page.screenshot({ path: file });
  files.push(file);
}
console.log(JSON.stringify({ total, files: files.length, logs: logs.slice(0, 15) }));
await browser.close();
