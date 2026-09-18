/**
 * Evaluation:  npm run eval              (uses the configured planner: Gemini when GEMINI_API_KEY is set)
 *
 * For each project in the corpus, files a synthetic report on its alignment (in a throwaway local
 * store), runs the investigator, and scores the result against the human-curated reference facts:
 *
 *   linked      did it link the report to the right project
 *   recall      share of reference facts it recovered as *verified* (same field, value supported)
 *   rejected    claims it proposed that the verifier did not accept (caught hallucinations or bad quotes)
 *   denied      tool calls blocked by Cedar or the neutral-language guard
 *
 * Writes a markdown report to eval-results/<timestamp>.md.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CIVICPROOF_DATA_DIR = mkdtempSync(path.join(tmpdir(), "civicproof-eval-"));
process.env.CIVICPROOF_STORE = "local";
process.env.CIVICPROOF_BLOBS = "local";

type Row = {
  project: string;
  linked: boolean;
  reference: number;
  recovered: number;
  verified: number;
  rejected: number;
  denied: number;
  tools: number;
  seconds: number;
  tokens?: string;
  error?: string;
};

async function main() {
  const { loadCorpus } = await import("../src/lib/corpus");
  const { createCase } = await import("../src/lib/cases");
  const { runInvestigation } = await import("../src/lib/agent/run");
  const { valueSupported } = await import("../src/lib/agent/text");
  const { config } = await import("../src/lib/config");
  const corpus = loadCorpus();
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const rows: Row[] = [];

  for (const project of corpus.projects) {
    if (only.length && !only.includes(project.id)) continue;
    const g = project.geometry!;
    const line = g.type === "LineString" ? g.coordinates : g.type === "MultiLineString" ? g.coordinates.reduce((a, b) => (b.length > a.length ? b : a)) : [g.coordinates];
    const [lng, lat] = line[Math.floor(line.length / 2)];
    const { caseData } = await createCase(
      {
        title: `Evaluation report on ${project.roadNames[0] ?? "the road"}`,
        description: "Evaluation report: potholes and a broken road surface along this stretch.",
        category: "pothole",
        lat,
        lng,
        locationSource: "map_pin",
        observedOn: new Date().toISOString().slice(0, 10),
      },
      [],
    );
    const t0 = Date.now();
    const done = await runInvestigation(caseData.id, () => {});
    const inv = done.investigation!;
    const recovered = project.reference.filter((ref) =>
      inv.claims.some((c) => c.field === ref.field && c.verification === "verified" && (!ref.value || (c.value && (valueSupported(ref.value, c.value) || valueSupported(c.value, ref.value))))),
    ).length;
    rows.push({
      project: project.id,
      linked: inv.selectedProjectId === project.id,
      reference: project.reference.length,
      recovered,
      verified: inv.claims.filter((c) => c.verification === "verified" && c.origin === "official_record").length,
      rejected: inv.claims.filter((c) => c.verification === "unverified" && c.origin !== "computed" && c.field !== "photo_observation").length + inv.claims.filter((c) => c.verification === "partially_verified").length,
      denied: inv.trace.filter((t) => t.kind === "denied").length,
      tools: inv.trace.filter((t) => t.tool).length,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      tokens: inv.usage ? `${inv.usage.inputTokens}/${inv.usage.outputTokens}` : undefined,
      error: inv.error,
    });
    const r = rows[rows.length - 1];
    console.log(`${r.linked ? "✓" : "✗"} ${project.id}: ${r.recovered}/${r.reference} reference facts, ${r.rejected} rejected, ${r.denied} denied, ${r.seconds}s${r.error ? ` — ${r.error}` : ""}`);
  }

  const totalRef = rows.reduce((s, r) => s + r.reference, 0);
  const totalRec = rows.reduce((s, r) => s + r.recovered, 0);
  const lines = [
    `# CivicProof evaluation — ${new Date().toISOString()}`,
    "",
    `Planner: **${config.planner}**${config.planner === "gemini" ? ` (${config.geminiModelId})` : config.planner === "bedrock" ? ` (${config.bedrockModelId})` : " (curated extractions; a baseline, not a model result)"}`,
    "",
    `Linked correctly: **${rows.filter((r) => r.linked).length}/${rows.length}** · Reference facts recovered as verified: **${totalRec}/${totalRef} (${totalRef ? Math.round((totalRec / totalRef) * 100) : 0}%)** · Claims not accepted by the verifier: **${rows.reduce((s, r) => s + r.rejected, 0)}** · Cedar/guard denials: **${rows.reduce((s, r) => s + r.denied, 0)}**`,
    "",
    "| Project | Linked | Recovered | Verified claims | Not accepted | Denied | Tool calls | Time (s) | Tokens in/out |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.project} | ${r.linked ? "yes" : "**no**"} | ${r.recovered}/${r.reference} | ${r.verified} | ${r.rejected} | ${r.denied} | ${r.tools} | ${r.seconds} | ${r.tokens ?? "—"} |`),
    "",
    "\"Not accepted\" counts claims the verifier marked unverified or partially verified: quotations that were not on the cited page, or values not in the quotation. They are shown in the case, never used as facts.",
  ];
  mkdirSync("eval-results", { recursive: true });
  const file = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${config.planner}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`\n${lines[4]}\n\nReport: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
