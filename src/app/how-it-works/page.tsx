import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { getCorpus } from "@/lib/corpus";
import { config } from "@/lib/config";
import { Container, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ArchitectureDiagram } from "./architecture";

export const metadata: Metadata = { title: "How it works", description: "The agent, the verifier, the permissions and the limits." };
export const dynamic = "force-dynamic";

const LOOP = [
  { k: "Intake", v: "get_case_report reads the report, the photo's EXIF metadata and, on Bedrock, a Claude vision description of the photo, labelled as an AI observation." },
  { k: "Locate", v: "find_projects_near measures the distance from the pin to every project alignment. select_project is only permitted for projects the search returned (a Cedar rule)." },
  { k: "Retrieve", v: "list_project_documents, search_documents (full-text over every page) and read_document_page give the model the actual text of the tender, award and completion records." },
  { k: "Extract", v: "record_claim proposes one fact with a quotation. The verifier checks the quotation against the page and the value against the quotation before the claim counts." },
  { k: "Gaps", v: "flag_missing names what could not be established and the record that would settle it; these become the RTI application." },
  { k: "Act", v: "Next actions are derived by rules from verified facts only: a defect-liability repair request if the observation falls inside the stated window, a complaint, and an RTI for the gaps." },
];

const LIMITS = [
  "The corpus is small and hand-assembled: 8 Bengaluru road projects from 9 public documents. A location with no project in the corpus gets an honest “not found” and an RTI draft, not a guess.",
  "City road alignments are traced from OpenStreetMap by road name, and whole roads are drawn where the tender covers only a reach. Distances for those projects are approximate.",
  "PMGSY maintenance windows are computed from the physical completion date and the programme guideline's 5-year rule. The individual contract was not available to confirm its terms.",
  "Contract agreements, completion certificates and measurement books are rarely published. Where they are missing, CivicProof asks for them rather than inferring them.",
  "Scanned PDFs without a text layer cannot be quoted. OCR (for example Amazon Textract) is not yet part of ingest.",
  "Complaint submission is manual. CivicProof drafts and tracks, but does not send anything to a government portal; there is no supported API to do so.",
  "The owner key is a bearer secret kept in the browser. Losing it means losing the ability to record updates for that case; there are no accounts.",
  "Rate limits are per server instance, backed by a daily DynamoDB counter and a Cedar budget policy. They protect the Bedrock bill, not against a determined attacker.",
];

function policy(file: string) {
  return readFileSync(path.join(process.cwd(), "policies", file), "utf8");
}

export default function HowItWorksPage() {
  const corpus = getCorpus();
  const facts = corpus.projects.reduce((s, p) => s + p.reference.length, 0);
  return (
    <div className="pb-10">
      <Container className="pt-10 sm:pt-14">
        <Reveal>
          <Eyebrow>Method</Eyebrow>
          <h1 className="mt-3 max-w-3xl font-serif text-[40px] leading-[1.05] tracking-[-0.01em] sm:text-[56px]">How a report becomes a case, and why you can check every step.</h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">
            CivicProof separates what a language model is good at (reading messy documents, finding the relevant page) from what it must never
            be trusted with alone (stating facts, taking actions). The model proposes; deterministic code verifies; the reporter decides.
          </p>
        </Reveal>
      </Container>

      <Container className="mt-14 [&>*]:min-w-0">
        <Reveal>
          <h2 className="font-serif text-[30px] leading-tight">Architecture</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-2">
            One Next.js application on AWS Lambda, deployed with an AWS SAM template in <code className="font-mono text-[13px]">infra/</code>.
            Every AWS integration is switched on by environment variables, so the same code also runs on a laptop with local files and the rules planner.
          </p>
        </Reveal>
        <Reveal className="mt-6">
          <ArchitectureDiagram />
        </Reveal>
        <p className="mt-3 font-mono text-[12px] text-ink-3">
          This instance: planner={config.planner}
          {config.planner === "bedrock" ? ` (${config.bedrockModelId})` : ""} · store={config.store} · blobs={config.blobs} · region={config.region}
        </p>
      </Container>

      <Container className="mt-20 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
        <Reveal>
          <h2 className="font-serif text-[30px] leading-tight">The agent loop</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            The investigator is a Strands Agents agent. With AWS credentials it runs Claude on Amazon Bedrock; without them, a rules planner
            (itself a Strands <code className="font-mono text-[13px]">Model</code>) drives the same tools, policies and verifier using curated
            extractions. The case page says which one ran.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Ten tools, all read-only or proposal-only. No tool can send, submit, change status or reach the internet.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <ol className="divide-y divide-rule rounded-2xl border border-rule bg-card shadow-card">
            {LOOP.map((s, i) => (
              <li key={s.k} className="grid gap-1 px-5 py-4 sm:grid-cols-[140px_1fr] sm:gap-4">
                <p className="font-medium"><span className="mr-2 font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>{s.k}</p>
                <p className="text-[14.5px] leading-relaxed text-ink-2">{s.v}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </Container>

      <Container className="mt-20 grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <h2 className="font-serif text-[30px] leading-tight">The grounding verifier</h2>
          <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink-2">
            <p>
              Every quotation is normalised (whitespace, dashes, quotes, the rupee sign) and searched for on the cited page. Then the claimed
              value must appear inside the quotation, compared as text, as an amount (₹1.25 crore = Rs. 125.00 lakhs), as a date (31.03.2025
              = 31 March 2025) or as a duration (5-year = 60 months).
            </p>
            <p>
              A quotation that only resembles the page is marked partially verified; one that can&apos;t be found is rejected and the claim is stored as
              unverified, shown with a dashed outline. Two verified claims that disagree are both marked as conflicting. Nothing is chosen silently.
            </p>
            <p>
              The same verifier runs at ingest: all {facts} curated facts in the corpus are re-checked against the extracted page text on every
              build, and the build fails if one no longer matches.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">A rejected claim: real verifier output</p>
            <pre tabIndex={0} aria-label="Example verifier output" className="mt-3 overflow-x-auto rounded-xl bg-paper-2 p-4 font-mono text-[12px] leading-relaxed text-ink-2">
{`record_claim({
  field: "contractor",
  value: "M/s Example Builders",
  citations: [{ doc_id: "kppp-bbmp-wt-pkg2-award",
                page: 1,
                quote: "supplierName: M/s Example Builders" }]
})

→ { verification: "unverified",
    rejected_citations: [
      "Excerpt not found on page 1 of \\"KPPP selected-bid
       (award) record — tender BBMP/2023-24/RD/WORK_INDENT1733\\"
       (best token overlap 33%)." ] }`}
            </pre>
          </div>
        </Reveal>
      </Container>

      <Container className="mt-20" id="policies">
        <Reveal>
          <h2 className="font-serif text-[30px] leading-tight">Permissions, in Cedar</h2>
          <p className="mt-2 max-w-3xl text-[15px] text-ink-2">
            Two policy files. The first is evaluated by Strands&apos; Cedar intervention before every tool call the model makes; denials are shown in
            the case trace and returned to the model. The second is evaluated by the API before any change to a case.
          </p>
        </Reveal>
        <div className="mt-6 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          {["agent-tools.cedar", "case-actions.cedar"].map((f) => (
            <Reveal key={f}>
              <div className="overflow-hidden rounded-2xl border border-ink/80 bg-ink">
                <p className="border-b border-paper/10 px-5 py-3 font-mono text-[12px] text-paper/60">policies/{f}</p>
                <pre tabIndex={0} aria-label={`policies/${f}`} className="max-h-[520px] overflow-auto px-5 py-4 font-mono text-[12px] leading-relaxed text-paper/85">{policy(f)}</pre>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>

      <Container className="mt-20 grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <h2 className="font-serif text-[30px] leading-tight">Security and privacy</h2>
          <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-ink-2">
            <li>No secrets in the browser. AWS access comes from the Lambda execution role, scoped to one table, one bucket and the configured Bedrock model.</li>
            <li>Uploads are checked by magic bytes, size-limited, re-encoded in the browser, fingerprinted with SHA-256 and served from a private bucket through the app.</li>
            <li>Reporter contact details are stored with the case and never returned by any public API.</li>
            <li>Every input is validated with Zod on the server; error responses never include internals.</li>
            <li>A neutral-language guard stops the model writing accusations (&ldquo;fraud&rdquo;, &ldquo;corruption&rdquo;…) into findings and asks it to rephrase.</li>
            <li>Investigations are capped per case and per day (Cedar + DynamoDB counter), and each run has a tool-call and time budget.</li>
          </ul>
        </Reveal>
        <Reveal delay={0.1} className="scroll-mt-24">
          <h2 id="limits" className="font-serif text-[30px] leading-tight">Known limitations</h2>
          <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-ink-2">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Reveal>
      </Container>

      <Container className="mt-20">
        <Reveal className="rounded-2xl border border-rule bg-card p-6 shadow-card sm:p-8">
          <h2 className="font-serif text-[26px] leading-tight">Where the records come from</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
            PMGSY road lists and quality grades from OMMAS (Ministry of Rural Development), the PMGSY Programme Guidelines, BBMP tender and
            award records from the Karnataka Public Procurement Portal&apos;s public API, a Bengaluru Smart City status presentation, and a CAG
            performance audit. Each is listed with its link and hash.
          </p>
          <Link href="/sources" className="mt-4 inline-block text-[14px] font-medium underline decoration-rule-strong underline-offset-4 hover:text-accent">
            Browse all records →
          </Link>
        </Reveal>
      </Container>
    </div>
  );
}
