/**
 * Live public records, end to end without the network: a stand-in OMMAS portal (layout page with an
 * anti-forgery token and session cookie, report request, report viewer, CSV export serving the real
 * Bengaluru Rural exports) and a scripted Gemini. The agent searches, is denied a record it did not
 * find, fetches the one it found, links the case to it by name, and quotes it; the verifier accepts
 * the quote, and the record is archived.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EXPORTS: Record<string, string> = {
  "45:1": "corpus/documents/ommas-slr-pmgsy1-bengaluru-rural.csv",
  "45:2": "corpus/documents/ommas-slr-pmgsy2-bengaluru-rural.csv",
  "45:4": "corpus/documents/ommas-slr-pmgsy3-bengaluru-rural.csv",
};
const ROAD = "MRL07-MDR (Budigere road) to Tellahally agrahara road via Boodihal, Channahally,Chikka Hosahally";
const RECORD_ID = `ommas-45-4-kn02120-${createHash("sha1").update(ROAD).digest("hex").slice(0, 6)}`;
const portal: Array<{ method: string; path: string; cookie?: string; body?: string }> = [];

let ommasServer: http.Server;
let gemini: http.Server;
let geminiCalls = 0;
let runInvestigation: typeof import("@/lib/agent/run").runInvestigation;
let createCase: typeof import("@/lib/cases").createCase;
let loadRecord: typeof import("@/lib/records").loadRecord;

const call = (name: string, args: Record<string, unknown> = {}) => [{ functionCall: { name, args } }];
const SCRIPT = [
  call("get_case_report"),
  call("find_projects_near", { radius_m: 750 }),
  call("fetch_public_record", { record_id: "ommas-45-4-kn09999-abcdef" }), // never searched: Cedar denies
  call("search_public_records", { query: "Budigere road" }),
  call("fetch_public_record", { record_id: RECORD_ID }),
  call("select_project", { project_id: RECORD_ID, reasons: ["The OMMAS record names Budigere road, the road in the report"] }),
  call("record_claim", {
    field: "contractor",
    text: "OMMAS lists the contractor as Ramesh V R.",
    value: "Ramesh V R",
    origin: "official_record",
    citations: [{ doc_id: RECORD_ID, page: 1, quote: "Contractor Name: Ramesh V R [15 Jun 2020]" }],
  }),
  call("finish", { summary: "The report names Budigere road; OMMAS lists PMGSY-III work KN02120 on it, with its contractor." }),
  [{ text: "Done." }],
];

beforeAll(async () => {
  ommasServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      portal.push({ method: req.method ?? "", path: url.pathname, cookie: req.headers.cookie, body });
      if (url.pathname === "/ProposalArea/Proposal/StateListWiseRoadsLayout") {
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "ASP.NET_SessionId=s1; path=/; HttpOnly" });
        return res.end('<form><input name="__RequestVerificationToken" type="hidden" value="tok-1" /></form>');
      }
      if (url.pathname === "/ProposalArea/Proposal/StateListWiseRoadsReport/") {
        const form = new URLSearchParams(body);
        if (form.get("__RequestVerificationToken") !== "tok-1" || !req.headers.cookie?.includes("ASP.NET_SessionId=s1")) {
          res.writeHead(403);
          return res.end();
        }
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<iframe src="/MvcReportViewer.aspx?d=${form.get("DistrictCode")}&amp;s=${form.get("Scheme")}"></iframe>`);
      }
      if (url.pathname === "/MvcReportViewer.aspx") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<script>var x={"ExportUrlBase":"/Export.axd?key=${url.searchParams.get("d")}:${url.searchParams.get("s")}\\u0026Format="}</script>`);
      }
      if (url.pathname === "/Export.axd") {
        const file = EXPORTS[url.searchParams.get("key") ?? ""];
        if (!file || url.searchParams.get("Format") !== "CSV") {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { "content-type": "text/csv" });
        return res.end(readFileSync(file));
      }
      res.writeHead(404);
      res.end();
    });
  });
  gemini = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const parts = SCRIPT[Math.min(geminiCalls++, SCRIPT.length - 1)];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20 } })}\r\n\r\n`);
    });
  });
  await new Promise<void>((r) => ommasServer.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", r));
  vi.stubEnv("CIVICPROOF_DATA_DIR", mkdtempSync(path.join(tmpdir(), "civicproof-live-")));
  vi.stubEnv("CIVICPROOF_PLANNER", "");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_ENDPOINT", `http://127.0.0.1:${(gemini.address() as AddressInfo).port}`);
  vi.stubEnv("OMMAS_BASE_URL", `http://127.0.0.1:${(ommasServer.address() as AddressInfo).port}`);
  ({ runInvestigation } = await import("@/lib/agent/run"));
  ({ createCase } = await import("@/lib/cases"));
  ({ loadRecord } = await import("@/lib/records"));
});

afterAll(async () => {
  await new Promise<void>((r) => ommasServer.close(() => r()));
  await new Promise<void>((r) => gemini.close(() => r()));
});

describe("live public records (OMMAS)", () => {
  it("searches the portal, fetches what it found, links by name, and the quote verifies", async () => {
    // Far from any road with map geometry, so only a search by name can find the work.
    const { caseData } = await createCase(
      {
        title: "Broken stretch on Budigere road",
        description: "The tarmac has broken up over about 50 m on Budigere road near the Boodihal turn.",
        category: "road_damage",
        lat: 13.2,
        lng: 77.9,
        locationSource: "map_pin",
        address: "Budigere road, Bengaluru Rural",
        observedOn: "2026-09-15",
      },
      [],
    );
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;

    // The portal was driven like a browser: token and session cookie on the report request.
    const report = portal.find((p) => p.path === "/ProposalArea/Proposal/StateListWiseRoadsReport/");
    expect(report?.cookie).toContain("ASP.NET_SessionId=s1");
    expect(new URLSearchParams(report?.body).get("DistrictCode")).toBe("45");

    expect(inv.trace.some((t) => t.kind === "denied" && t.tool === "fetch_public_record")).toBe(true);
    expect(inv.status).toBe("complete");
    expect(inv.selectedProjectId).toBe(RECORD_ID);
    expect(inv.matches.find((m) => m.projectId === RECORD_ID)?.linkedBy).toBe("name");
    expect(inv.records).toEqual([RECORD_ID]);
    const contractor = inv.claims.find((c) => c.field === "contractor");
    expect(contractor?.verification).toBe("verified");
    expect(inv.evidence.find((e) => contractor?.evidenceIds.includes(e.id))?.docId).toBe(RECORD_ID);

    const archived = await loadRecord(RECORD_ID);
    expect(archived?.pages[0]).toContain("Package No.: KN02120");
    expect(archived?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(archived?.roadNames).toContain("Boodihal");
  });
});
