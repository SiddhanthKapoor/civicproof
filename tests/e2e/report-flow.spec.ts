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

test("reporter adds an RTI reply; only they can read it", async ({ page, request, browser }) => {
  const form = { title: "Document flow check", description: "Checking that a reporter can add a document to the case.", category: "pothole", lat: "12.826842", lng: "77.617364", locationSource: "map_pin", observedOn: "2026-09-10" };
  const created = await (await request.post("/api/cases", { multipart: form })).json();
  const { id, ownerKey } = created as { id: string; ownerKey: string };

  await page.goto("/");
  await page.evaluate(([i, k]) => localStorage.setItem(`civicproof:owner:${i}`, k), [id, ownerKey]);
  await page.goto(`/cases/${id}#tracking`);
  await expect(page.getByText("Documents you received")).toBeVisible();
  await page.locator('input[name="file"]').setInputFiles(path.join(process.cwd(), "corpus/documents/ommas-quality-grading-bangalore-urban.pdf"));
  await page.getByLabel("Title").last().fill("PIO reply with quality grades");
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByText(/pages? of text are now available/)).toBeVisible();

  await page.getByRole("link", { name: "Read" }).click();
  await expect(page.getByRole("heading", { name: "PIO reply with quality grades" })).toBeVisible();
  await expect(page.getByText("Works Wise Grading Abstract")).toBeVisible();

  // A different browser (no owner key) sees neither the panel nor the text.
  const stranger = await browser.newPage();
  await stranger.goto(`/cases/${id}`);
  await expect(stranger.getByText(/The reporter has added 1 document/)).toBeVisible();
  const res = await request.get(`/api/cases/${id}/documents/${(await (await request.get(`/api/cases/${id}`)).json()).case.documents[0].id}`);
  expect(res.status()).toBe(403);
  await stranger.close();
});

test("the reporter's name and saved packets stay private", async ({ page, request, browser }) => {
  const form = { title: "Privacy check on Kodathi road", description: "Checking that the reporter's details stay private.", category: "pothole", lat: "12.894573", lng: "77.71297", locationSource: "map_pin", observedOn: "2026-09-12", reporterName: "Meera Iyer" };
  const { id, ownerKey } = (await (await request.post("/api/cases", { multipart: form })).json()) as { id: string; ownerKey: string };
  expect(JSON.stringify(await (await request.get(`/api/cases/${id}`)).json())).not.toContain("Meera Iyer");
  expect((await request.get(`/api/cases/${id}/packet`)).status()).toBe(403);

  // The owner's browser fills their name into the complaint.
  await page.goto("/");
  await page.evaluate(([i, k]) => localStorage.setItem(`civicproof:owner:${i}`, k), [id, ownerKey]);
  await page.goto(`/cases/${id}/packet?kind=complaint`);
  await expect(page.getByLabel("From")).toHaveValue(/Name: Meera Iyer/);

  // Anyone else gets placeholders.
  const stranger = await browser.newPage();
  await stranger.goto(`/cases/${id}/packet?kind=complaint`);
  await expect(stranger.getByLabel("From")).toHaveValue(/\[Your full name\]/);
  await expect(stranger.getByText("Meera Iyer")).toHaveCount(0);
  await stranger.close();

  // No RTI on record yet, so asking for an appeal explains why instead of drafting one.
  await page.goto(`/cases/${id}/packet?kind=appeal`);
  await expect(page.getByText(/A first appeal needs a recorded RTI application/)).toBeVisible();
});

test("a rejected work number is never shown as the one that was confirmed", async ({ page, request }) => {
  // The reporter mistypes the board. Identity still comes from the project's own record, so the
  // case is VERIFIED — but the string that failed validation must not appear where a confirmed
  // work number goes, or the page asserts the opposite of what happened.
  const form = {
    title: "Board was unreadable at the Kodathi turn",
    description: "Potholes across the lane; the project board is faded and I could not read the number.",
    category: "pothole", lat: "12.894573", lng: "77.71297",
    locationSource: "map_pin", observedOn: "2026-09-15", jobCode: "NOT-A-CODE-!!",
  };
  const { id } = (await (await request.post("/api/cases", { multipart: form })).json()) as { id: string };
  await request.post(`/api/cases/${id}/investigate`);

  await page.goto(`/cases/${id}`);
  await expect(page.getByText("What the evidence establishes")).toBeVisible();

  // The rejection is explained in full, quoting what was supplied.
  await expect(page.getByText(/is not in the form of an identifier this registry uses/)).toBeVisible();

  // But it is not presented as the project's identifier, in either place a code is displayed.
  const identity = page.locator("section", { has: page.getByText("What the evidence establishes") });
  await expect(identity.getByText("NOT-A-CODE", { exact: true })).toHaveCount(0);
  const projectTile = page.locator("li", { has: page.getByText("Project", { exact: true }) });
  await expect(projectTile.getByText(/NOT-A-CODE/)).toHaveCount(0);
});

test("an active DLP is shown in full, and never as a finding about a person", async ({ page, request }) => {
  const cases = (await (await request.get("/api/cases")).json()) as { cases?: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>;
  const rows = Array.isArray(cases) ? cases : (cases.cases ?? []);
  const golden = rows.find((c) => c.title === "Potholes along the Kodathi–Mullur road")!;
  await page.goto(`/cases/${golden.id}`);

  const dlp = page.getByRole("region", { name: "Defect liability / maintenance period" });
  await expect(dlp.getByText("DLP STATUS: ACTIVE")).toBeVisible();

  // Every input the arithmetic used, so a reader can redo it rather than trust it.
  for (const label of ["Recorded completion date", "Maintenance duration", "DLP start date", "DLP end date", "Evaluated on"]) {
    await expect(dlp.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(dlp.getByText("05-03-2022").first()).toBeVisible(); // completion, and the period's start
  await expect(dlp.getByText("2027-03-05").first()).toBeVisible(); // completion + 60 months

  // The boundary, stated where the status is read.
  await expect(
    dlp.getByText(/An active DLP provides contractual\/maintenance context\. It does not by itself establish who is responsible for the observed defect\./),
  ).toBeVisible();

  // An open period is never turned into blame anywhere on the page.
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toMatch(/\bcaused\b|\bat fault\b|\bliable\b|\bnegligen|\bbreach of contract\b/i);
});

test("the photograph is kept separate from the public record, and an unusable one is never read", async ({ page, request }) => {
  const cases = (await (await request.get("/api/cases")).json()) as { cases?: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>;
  const rows = Array.isArray(cases) ? cases : (cases.cases ?? []);

  // A case with a usable photograph: the observation is shown, and labelled as the reporter's.
  const withPhoto = rows.find((c) => c.title === "Potholes along the Kodathi–Mullur road")!;
  await page.goto(`/cases/${withPhoto.id}`);
  const panel = page.getByRole("region", { name: "Photograph and citizen observation" });
  await expect(panel.getByText("Reporter’s evidence, not a public record")).toBeVisible();
  await expect(panel.getByText("Usable", { exact: true })).toBeVisible();
  await expect(panel.getByText("Visible infrastructure defect")).toBeVisible();
  await expect(panel.getByText(/does not establish who is responsible for that condition/)).toBeVisible();

  // A case with no photograph: nothing is read from it, and nothing is concluded about the ground.
  const noPhoto = rows.find((c) => c.title === "Potholes on the inner road in BTM Layout")!;
  await page.goto(`/cases/${noPhoto.id}`);
  const panel2 = page.getByRole("region", { name: "Photograph and citizen observation" });
  await expect(panel2.getByText("None submitted")).toBeVisible();
  await expect(panel2.getByText("Not interpreted")).toBeVisible();
  await expect(panel2.getByText("There is no photograph to read.")).toBeVisible();
});

test("the scope comparison is made only from a cited record, and never implies causation", async ({ page, request }) => {
  const cases = (await (await request.get("/api/cases")).json()) as { cases?: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>;
  const rows = Array.isArray(cases) ? cases : (cases.cases ?? []);

  // A project whose own records describe the work: the comparison is made, and sourced.
  const related = rows.find((c) => c.title === "Potholes along the Kodathi–Mullur road")!;
  await page.goto(`/cases/${related.id}`);
  const panel = page.getByRole("region", { name: "Scope relationship" });
  await expect(panel.getByText("POTENTIALLY RELATED")).toBeVisible();
  // The scope it rests on is shown, with a link to the page it was read from.
  await expect(panel.getByText(/Upgrade of a 4\.250 km road/)).toBeVisible();
  await expect(panel.getByRole("link", { name: /SLR: Statewise List of Works.*p\. 1/ })).toBeVisible();
  await expect(
    panel.getByText(/This supports a potential relationship between the reported condition and the project scope\. It does not establish causation or responsibility\./),
  ).toBeVisible();

  // A project with no scope record: the comparison is refused, and proximity is ruled out loudly.
  const unknown = rows.find((c) => c.title === "Broken paving and a sunken patch on Lavelle Road")!;
  await page.goto(`/cases/${unknown.id}`);
  const panel2 = page.getByRole("region", { name: "Scope relationship" });
  await expect(panel2.getByText("UNKNOWN", { exact: true })).toBeVisible();
  await expect(panel2.getByText(/No scope of work is established in this project’s own records\./)).toBeVisible();
  await expect(panel2.getByText(/A project being nearby is not enough to place a defect inside its scope\./)).toBeVisible();
});

test("the case page reads in the order a citizen needs it", async ({ page, request }) => {
  const cases = (await (await request.get("/api/cases")).json()) as { cases?: Array<{ id: string; title: string }> } | Array<{ id: string; title: string }>;
  const rows = Array.isArray(cases) ? cases : (cases.cases ?? []);
  const golden = rows.find((c) => c.title === "Potholes along the Kodathi–Mullur road")!;
  await page.goto(`/cases/${golden.id}`);

  // Evidence before conclusion: the report and what was found come first, the verdict after them,
  // then what to do, and the technical account of the run last.
  const order = [
    "Reported problem",
    "Photograph and citizen observation",
    "Project identification",
    "Contractor",
    "Contract information",
    "Defect liability / maintenance period",
    "Scope relationship",
    "What the evidence establishes",
    "What to do next",
    "Tracking",
    "How this was investigated",
  ];
  // textContent, not innerText: these labels are uppercased in CSS, which innerText applies.
  const body = ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ");
  let cursor = -1;
  for (const label of order) {
    const at = body.indexOf(label, cursor + 1);
    expect(at, `"${label}" should appear after the section before it`).toBeGreaterThan(cursor);
    cursor = at;
  }

  // The five kinds of statement are named once, in plain words, before any of them is used.
  for (const kind of ["Verified fact", "Citizen observation", "System determination", "Missing evidence", "Human review required"]) {
    await expect(page.getByText(kind, { exact: false }).first()).toBeVisible();
  }
});

test("where to submit names an official channel, and leaves submitting to the citizen", async ({ page, request }) => {
  const cases = (await (await request.get("/api/cases")).json()) as { cases: Array<{ id: string; title: string }> };
  const golden = cases.cases.find((c) => c.title === "Potholes along the Kodathi–Mullur road")!;
  await page.goto(`/cases/${golden.id}/packet?kind=complaint`);

  const where = page.getByRole("region", { name: "Where to submit" });
  await expect(where.getByText("Authority", { exact: true })).toBeVisible();
  await expect(where.getByText("Official channel", { exact: true })).toBeVisible();
  await expect(where.getByText("Submission method", { exact: true })).toBeVisible();

  // The portal opens in the citizen's own browser, on a government domain, and nowhere else.
  const open = where.getByRole("link", { name: /Open official portal/ });
  await expect(open).toBeVisible();
  const href = await open.getAttribute("href");
  expect(href).toMatch(/^https:\/\/([a-z0-9-]+\.)*(gov|nic)\.in(\/|$)/);
  await expect(open).toHaveAttribute("target", "_blank");

  // The boundary, said where the submit button would otherwise be.
  await expect(where.getByText(/CivicProof prepares the evidence and complaint\. Final submission remains under the citizen’s control\./)).toBeVisible();
  await expect(where.getByText(/Complete the sign-in, CAPTCHA or other verification the portal asks for\./)).toBeVisible();

  // Nothing on this page submits anything anywhere.
  const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
  expect(body).not.toMatch(/submit (?:this )?(?:complaint|now) to|we will submit|sending to the authority/);
});
