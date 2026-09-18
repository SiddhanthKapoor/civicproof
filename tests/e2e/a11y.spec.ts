import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// WCAG 2.1 AA checks on every main page (map canvases excluded: third-party tiles and controls).
const PAGES = ["/", "/report", "/cases", "/sources", "/how-it-works", "/sources/kppp-bbmp-wt-pkg2-bid?page=56"];

test.use({ reducedMotion: "reduce" });

test("main pages have no WCAG A/AA violations", async ({ page, request }) => {
  const cases = await (await request.get("/api/cases")).json();
  const caseId = cases.cases.find((c: { title: string }) => /Kodathi/.test(c.title))?.id ?? cases.cases[0].id;
  const report: string[] = [];
  for (const p of [...PAGES, `/cases/${caseId}`, `/cases/${caseId}/packet?kind=complaint`, "/projects/pmgsy-kn03-70"]) {
    await page.goto(p);
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      // Scroll through so in-view reveals settle before measuring contrast.
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".maplibregl-map").analyze();
    for (const v of results.violations) report.push(`${p} · ${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  }
  console.log(report.join("\n") || "no violations");
  expect(report).toEqual([]);
});
