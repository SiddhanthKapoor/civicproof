// Regenerates docs/screenshots/*.png from a running server: node scripts/dev/readme-shots.mjs http://localhost:3100
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://localhost:3100";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const cases = await (await fetch(`${base}/api/cases`)).json();
const pick = (re) => cases.cases.find((c) => re.test(c.title))?.id;
const kodathi = pick(/Kodathi/), junction = pick(/Brigade/);

async function shot(path, file, { scrollTo, wait = 1800, clip } = {}) {
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  if (scrollTo) {
    await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -90));
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `docs/screenshots/${file}`, clip });
  console.log("saved", file);
}

await shot("/", "home.png", { wait: 3000 });
await shot(`/cases/${kodathi}`, "case.png", { wait: 3500 });
await shot(`/cases/${kodathi}`, "evidence.png", { scrollTo: "#evidence" });
await shot(`/cases/${junction}`, "candidates.png", { scrollTo: "#chain" });
await shot(`/cases/${kodathi}/packet?kind=complaint`, "packet.png");
await shot("/cases", "cases-map.png", { wait: 6000 });
await shot("/sources/kppp-bbmp-wt-pkg2-bid?page=56&q=Maintenance%20of%20all%20the%20Infrastructural%20Facilities%20developed%20for%20a%20Defect%20Liability%20Period%20of%205%20years", "source.png", { wait: 2500 });
await shot("/how-it-works", "architecture.png", { scrollTo: "svg[role=img]" });

// Live run
await page.goto(`${base}/cases/${pick(/Hebbagodi/)}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /Run again/ }).click();
await page.waitForTimeout(2200);
await page.locator("#investigation").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -90));
await page.screenshot({ path: "docs/screenshots/live.png" });
console.log("saved live.png");
await b.close();
