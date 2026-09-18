// Renders the PWA icons from the brand mark (src/app/icon.svg geometry):  node scripts/dev/make-icons.mjs
import { chromium } from "@playwright/test";

const mark = (scale) => {
  // The mark is drawn on a 32-unit grid; `scale` shrinks it around the centre (maskable icons need a safe zone).
  const t = (16 * (1 - scale)).toFixed(3);
  return `<g transform="translate(${t} ${t}) scale(${scale})"><path d="M11 6H6.5v20H11M21 6h4.5v20H21" fill="none" stroke="#16181d" stroke-width="2.8" stroke-linecap="square"/><circle cx="16" cy="16" r="4" fill="#2542c8"/></g>`;
};
const svg = ({ rounded, scale }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%"><rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="#f6f4ef"/>${mark(scale)}</svg>`;

const outputs = [
  { file: "public/icons/icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "public/icons/icon-512.png", size: 512, rounded: true, scale: 1 },
  { file: "public/icons/maskable-192.png", size: 192, rounded: false, scale: 0.62 },
  { file: "public/icons/maskable-512.png", size: 512, rounded: false, scale: 0.62 },
  { file: "src/app/apple-icon.png", size: 180, rounded: false, scale: 0.8 },
];

const browser = await chromium.launch();
for (const o of outputs) {
  const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(o)}</body></html>`);
  await page.screenshot({ path: o.file, omitBackground: true });
  await page.close();
  console.log("wrote", o.file);
}
await browser.close();
