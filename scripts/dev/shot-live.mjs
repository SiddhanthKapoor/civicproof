// Captures the investigation panel while a run is streaming: clicks "Run again", waits, screenshots.
import { chromium } from "@playwright/test";
const [url, out, delay = "1800"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.getByRole("button", { name: /Run again|Start investigation/ }).click();
await p.waitForTimeout(+delay);
await p.locator("#investigation").scrollIntoViewIfNeeded();
await p.screenshot({ path: out });
await b.close();
