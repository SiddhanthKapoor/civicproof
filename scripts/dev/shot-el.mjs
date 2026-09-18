// Usage: node scripts/dev/shot-el.mjs <url> <selector> <out.png> [width]
import { chromium } from "@playwright/test";
const [url, sel, out, w = "1440"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: +w, height: 900 } });
await p.goto(url, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.locator(sel).first().scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
await p.locator(sel).first().screenshot({ path: out });
await b.close();
