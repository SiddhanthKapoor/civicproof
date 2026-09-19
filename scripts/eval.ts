/**
 * Evaluation:  npm run eval              (uses the configured planner: Gemini when GEMINI_API_KEY is set)
 *
 * For each project in the corpus that has a map alignment, files a synthetic report on it (in a throwaway local
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
    // Projects without an alignment are found by name, which a synthetic pin can't exercise.
    if (!project.geometry) continue;
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
  const linked = rows.filter((r) => r.linked).length;
  const rejected = rows.reduce((s, r) => s + r.rejected, 0);
  const denied = rows.reduce((s, r) => s + r.denied, 0);
  const errored = rows.filter((r) => r.error).length;

  // What this harness does NOT cover, stated with the numbers so the headline cannot be read as
  // whole-corpus accuracy: only projects with a mapped alignment can be probed with a synthetic pin.
  const corpusProjects = corpus.projects.length;
  const corpusFacts = corpus.projects.reduce((n, p) => n + p.reference.length, 0);
  const scope =
    `Scope: **${rows.length} of ${corpusProjects} projects** (${Math.round((rows.length / corpusProjects) * 100)}%) and ` +
    `**${totalRef} of ${corpusFacts} reference facts** (${Math.round((totalRef / corpusFacts) * 100)}%). ` +
    `Only projects with a mapped alignment can be probed with a synthetic pin, so the rest are out of scope here.`;
  const nature =
    config.planner === "rules"
      ? "This is a **deterministic replay** of curated extractions through the real agent loop, Cedar policies and verifier — a corpus-integrity and pipeline check, **not a measure of model accuracy**."
      : `This run used a language model (**${config.planner}**), so it measures that model's behaviour on this subset.`;

  const lines = [
    `# CivicProof evaluation — ${new Date().toISOString()}`,
    "",
    `Planner: **${config.planner}**${config.planner === "gemini" ? ` (${config.geminiModelId})` : config.planner === "bedrock" ? ` (${config.bedrockModelId})` : " (curated extractions; a baseline, not a model result)"}`,
    "",
    `Linked correctly: **${linked}/${rows.length}** · Reference facts recovered as verified: **${totalRec}/${totalRef} (${totalRef ? Math.round((totalRec / totalRef) * 100) : 0}%)** · Claims not accepted by the verifier: **${rejected}** · Cedar/guard denials: **${denied}** · Runs that errored: **${errored}**`,
    "",
    scope,
    "",
    nature,
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
  console.log(`\n${lines[4]}\n\n${scope}\n${nature}\n\nReport: ${file}`);

  // Thresholds, so a catastrophic run cannot pass silently. Overridable for exploratory runs.
  const minLinked = Number(process.env.EVAL_MIN_LINKED ?? 100);
  const minRecall = Number(process.env.EVAL_MIN_RECALL ?? 100);
  const linkedPct = rows.length ? (linked / rows.length) * 100 : 0;
  const recallPct = totalRef ? (totalRec / totalRef) * 100 : 0;
  const failures: string[] = [];
  if (!rows.length) failures.push("no projects were evaluated");
  if (linkedPct < minLinked) failures.push(`linked ${linkedPct.toFixed(1)}% < required ${minLinked}%`);
  if (recallPct < minRecall) failures.push(`fact recall ${recallPct.toFixed(1)}% < required ${minRecall}%`);
  if (errored) failures.push(`${errored} run(s) errored`);
  if (failures.length) {
    console.error(`\nEvaluation FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("Evaluation passed its thresholds.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
