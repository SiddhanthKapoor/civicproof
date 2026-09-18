import Link from "next/link";
import { getStore } from "@/lib/store";
import { getCorpus } from "@/lib/corpus";
import { config } from "@/lib/config";
import { CLAIM_FIELD_LABELS, type Claim, type Evidence } from "@/lib/schemas";
import { ButtonLink, Container, Eyebrow, OriginTag, VerificationBadge } from "@/components/ui";
import { WordReveal } from "@/components/word-reveal";
import { AnimatedGroup } from "@/components/motion-primitives/animated-group";
import { Reveal } from "@/components/reveal";
import { HomeSpecimen, type SpecimenRow } from "./home-specimen";

export const dynamic = "force-dynamic";

function rowFrom(claim: Claim | undefined, evidence: Evidence[], label?: string): SpecimenRow | undefined {
  if (!claim) return undefined;
  const ev = evidence.find((e) => claim.evidenceIds.includes(e.id));
  const value = claim.field === "maintenance_window" && claim.value?.startsWith("inside:")
    ? `Inside, until ${new Date(claim.value.slice(7) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
    : claim.value ?? claim.text;
  return {
    label: label ?? CLAIM_FIELD_LABELS[claim.field],
    value,
    verification: claim.verification,
    origin: claim.origin,
    excerpt: claim.field === "maintenance_window" ? undefined : ev?.excerpt.replace(/\s+/g, " "),
    source: ev?.sourceTitle,
    page: ev?.page,
  };
}

async function loadSpecimen() {
  const store = getStore();
  const list = await store.list(100);
  const pick = list.find((c) => c.projectId?.startsWith("pmgsy") && c.verifiedClaims > 0) ?? list.find((c) => c.verifiedClaims > 0);
  if (!pick) return null;
  const c = await store.get(pick.id);
  const inv = c?.investigation;
  if (!c || !inv) return null;
  const get = (f: Claim["field"]) => inv.claims.find((cl) => cl.field === f);
  const rows = [
    rowFrom(get("contractor"), inv.evidence),
    rowFrom(get("completion_date"), inv.evidence, "Physical completion"),
    rowFrom(get("maintenance_window"), inv.evidence, "5-year maintenance window"),
  ].filter(Boolean) as SpecimenRow[];
  return { caseId: c.id, title: c.title, project: pick.projectName ?? "", rows };
}

const STEPS = [
  {
    n: "01",
    title: "Report",
    body: "A photo, a pin and a date. The photo's GPS and capture time are read in your browser, and the file is fingerprinted with SHA-256.",
  },
  {
    n: "02",
    title: "Locate",
    body: "The location is matched against the alignments of public works projects, using official GIS where it exists and labelled approximations where it doesn't.",
  },
  {
    n: "03",
    title: "Verify",
    body: "An agent reads the tender, award and completion records. Each fact must quote the page it came from, and a verifier rejects any quote it cannot find.",
  },
  {
    n: "04",
    title: "Act",
    body: "You get a complaint that cites its sources, an RTI application for whatever is missing, and a timeline that tracks when each reply is due.",
  },
];

const STATES: Array<{ v: "verified" | "partially_verified" | "unverified" | "contradicted"; text: string }> = [
  { v: "verified", text: "The quoted words, including the value, were found on the cited page." },
  { v: "partially_verified", text: "The source exists, but the value could not be matched word for word." },
  { v: "unverified", text: "No citation survived the check. Shown, never relied on." },
  { v: "contradicted", text: "Two records disagree. Both are shown and neither is chosen." },
];

export default async function Home() {
  const corpus = getCorpus();
  const specimen = await loadSpecimen().catch(() => null);
  const cases = await getStore().list(500).catch(() => []);
  const facts = corpus.projects.reduce((s, p) => s + p.reference.length, 0);
  const pages = corpus.documents.reduce((s, d) => s + (d.pageCount ?? 0), 0);
  const publishers = [...new Set(corpus.documents.map((d) => d.publisher.split(",")[0].split(" (")[0]))];

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-rule">
        <div aria-hidden className="grain pointer-events-none absolute inset-0 opacity-60" />
        <Container className="relative grid gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20 [&>*]:min-w-0">
          <div>
            <Eyebrow>Public works accountability · Bengaluru pilot</Eyebrow>
            <WordReveal
              text="Turn a broken road into a documented case."
              className="mt-5 max-w-[14ch] font-serif text-[46px] leading-[1.02] tracking-[-0.02em] text-ink sm:text-[64px] lg:text-[76px]"
            />
            <Reveal delay={0.5}>
              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
                Report what you see. CivicProof finds the public works record for that spot, checks every fact against the official
                document, and drafts the complaint, or the RTI application for whatever the records leave out.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href="/report" size="lg">Report an issue</ButtonLink>
                <ButtonLink href="/cases" size="lg" variant="secondary">Explore cases</ButtonLink>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-3">
                <li>No account needed</li>
                <li aria-hidden>·</li>
                <li>Every fact cites its page</li>
                <li aria-hidden>·</li>
                <li>Nothing is sent without you</li>
              </ul>
            </Reveal>
          </div>
          {specimen && specimen.rows.length > 0 ? (
            <HomeSpecimen {...specimen} />
          ) : (
            <div className="rounded-[22px] border border-dashed border-rule-strong p-8 text-[14px] text-ink-3">
              Run <code className="font-mono">npm run seed</code> to load the demo reports.
            </div>
          )}
        </Container>
      </section>

      {/* The gap */}
      <section className="border-b border-rule">
        <Container className="grid gap-10 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-24 [&>*]:min-w-0">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="mt-4 max-w-md font-serif text-[36px] leading-[1.08] tracking-[-0.01em] sm:text-[44px]">
              Reporting a pothole is easy. Proving who owes the repair is not.
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="space-y-5 text-[16px] leading-relaxed text-ink-2">
            <p>
              The facts that make a complaint hard to ignore are public, but scattered: a tender on the state procurement portal, an award
              record, a completion date in a scheme database, a five-year maintenance clause on page 56 of a bid document.
            </p>
            <p>
              Most complaint channels capture the photo and stop there. Procurement portals start from the contract and assume you already know
              which one you are looking for. CivicProof starts where you are standing, and treats every record the way a careful
              journalist would: quoted, cited to the page, and marked as unconfirmed when it can&apos;t be checked.
            </p>
            <dl className="grid grid-cols-3 gap-4 border-t border-rule pt-6">
              {[
                { k: "Official documents", v: corpus.documents.length },
                { k: "Pages searchable", v: pages },
                { k: "Facts checked at ingest", v: facts },
              ].map((s) => (
                <div key={s.k}>
                  <dd className="tnum font-serif text-[36px] leading-none text-ink">{s.v}</dd>
                  <dt className="mt-2 text-[12.5px] text-ink-3">{s.k}</dt>
                </div>
              ))}
            </dl>
          </Reveal>
        </Container>
      </section>

      {/* How it works */}
      <section className="border-b border-rule bg-paper-2/50">
        <Container className="py-16 lg:py-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-4 font-serif text-[36px] leading-tight tracking-[-0.01em] sm:text-[44px]">From a pin to a paper trail.</h2>
            </div>
            <Link href="/how-it-works" className="text-[14px] font-medium text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">
              The full method →
            </Link>
          </Reveal>
          <AnimatedGroup preset="blur-slide" className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="flex h-full flex-col bg-card p-6">
                <span className="font-mono text-[12px] text-ink-3">{s.n}</span>
                <h3 className="mt-6 font-serif text-[26px] leading-none">{s.title}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            ))}
          </AnimatedGroup>
        </Container>
      </section>

      {/* Receipts */}
      <section className="border-b border-rule">
        <Container className="grid gap-12 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24 [&>*]:min-w-0">
          <Reveal>
            <Eyebrow>Evidence over confidence</Eyebrow>
            <h2 className="mt-4 max-w-lg font-serif text-[36px] leading-[1.08] tracking-[-0.01em] sm:text-[44px]">Every claim carries its receipt.</h2>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-2">
              The language model proposes; a deterministic verifier decides. A contractor&apos;s name only counts as verified when the
              words containing it are found, verbatim, on the page the model cited. Nothing unverified reaches the complaint as fact.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <OriginTag o="official_record" />
              <OriginTag o="user_report" />
              <OriginTag o="ai_inference" />
              <OriginTag o="computed" />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="divide-y divide-rule rounded-2xl border border-rule bg-card shadow-card">
              {STATES.map((s) => (
                <li key={s.v} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
                  <VerificationBadge v={s.v} className="w-fit sm:w-[150px] sm:justify-start" />
                  <p className="text-[14.5px] text-ink-2">{s.text}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      {/* AI boundaries */}
      <section className="border-b border-rule bg-ink text-paper">
        <Container className="grid gap-12 py-16 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:py-24 [&>*]:min-w-0">
          <Reveal>
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-paper/50">What the agent may do</p>
            <h2 className="mt-4 max-w-md font-serif text-[36px] leading-[1.08] tracking-[-0.01em] sm:text-[44px]">It investigates. It never files, accuses or invents.</h2>
            <ul className="mt-8 space-y-3 text-[15px] text-paper/80">
              <li>Reads the report and the official documents, one page at a time.</li>
              <li>Links the report to a project only if the location search returned it.</li>
              <li>Records facts with quotations, and flags what it could not establish.</li>
              <li>Cannot mark a case submitted or resolved. Only the reporter can.</li>
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="overflow-hidden rounded-2xl border border-paper/15 bg-paper/[0.04]">
              <div className="flex items-center justify-between border-b border-paper/10 px-5 py-3">
                <span className="font-mono text-[12px] text-paper/60">policies/case-actions.cedar</span>
                <span className="text-[11px] text-paper/40">enforced on every change</span>
              </div>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed text-paper/85">
{`// Nobody except the reporter can declare a case
// submitted, answered, resolved or closed.
forbid (principal, action == Action::"ChangeStatus", resource)
when {
  ["submitted", "awaiting_response",
   "resolved", "closed"].contains(context.to_status)
}
unless { principal is Reporter && context.is_owner };`}
              </pre>
            </div>
            <p className="mt-4 text-[13px] text-paper/50">
              Written in Cedar, AWS&apos;s open-source policy language, and evaluated by Strands Agents before each of the agent&apos;s tool calls.
            </p>
          </Reveal>
        </Container>
      </section>

      {/* AWS */}
      <section className="border-b border-rule">
        <Container className="py-16 lg:py-24">
          <Reveal className="max-w-2xl">
            <Eyebrow>Built on AWS</Eyebrow>
            <h2 className="mt-4 font-serif text-[36px] leading-tight tracking-[-0.01em] sm:text-[44px]">Small, auditable, serverless.</h2>
          </Reveal>
          <AnimatedGroup preset="fade" className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {[
              { k: "Amazon Bedrock", v: "Claude reads the documents through the Converse API, with tool use and vision for the photo." },
              { k: "Strands Agents", v: "AWS's open-source agent SDK runs the tool loop, streaming each step to the case page." },
              { k: "Cedar", v: "Policies authorize every tool call and every status change, and deny anything unlisted." },
              { k: "AWS Lambda", v: "The app runs behind a Function URL in response-streaming mode, deployed with AWS SAM." },
              { k: "DynamoDB + S3", v: "Cases in a single table with optimistic locking; photos and packet PDFs in a private bucket." },
              { k: "CloudWatch", v: "Structured JSON logs for every case, run, denial and packet, ready for Logs Insights." },
            ].map((a) => (
              <div key={a.k} className="bg-card p-6">
                <h3 className="text-[16px] font-semibold">{a.k}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{a.v}</p>
              </div>
            ))}
          </AnimatedGroup>
          <p className="mt-5 font-mono text-[12px] text-ink-3">
            This deployment: {config.planner === "bedrock" ? `Claude on Bedrock (${config.bedrockModelId})` : "rules planner (Bedrock not configured)"} ·{" "}
            {config.store === "dynamodb" ? "DynamoDB" : "local storage"} · {config.blobs === "s3" ? "S3" : "local files"}
          </p>
        </Container>
      </section>

      {/* Records */}
      <section>
        <Container className="grid gap-10 py-16 lg:grid-cols-[1fr_1.2fr] lg:gap-16 lg:py-24 [&>*]:min-w-0">
          <Reveal>
            <Eyebrow>What is real here</Eyebrow>
            <h2 className="mt-4 font-serif text-[36px] leading-tight tracking-[-0.01em] sm:text-[44px]">Real records. Labelled demos.</h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-2">
              The corpus is {corpus.documents.length} public documents covering {corpus.projects.length} Bengaluru road projects, each
              stored with its source link and SHA-256. The {cases.filter((c) => c.demo).length} demo reports are illustrative and marked
              as such; nothing has been filed with any authority.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/sources" variant="secondary">Browse the records</ButtonLink>
              <ButtonLink href="/report" variant="ghost">Report an issue →</ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="divide-y divide-rule border-y border-rule">
              {corpus.documents.slice(0, 7).map((d) => (
                <li key={d.id}>
                  <Link href={`/sources/${d.id}`} className="group flex items-baseline justify-between gap-4 py-3.5">
                    <span className="text-[15px] leading-snug text-ink group-hover:text-accent">{d.title}</span>
                    <span className="shrink-0 font-mono text-[12px] text-ink-3">{d.pageCount} p.</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-ink-3">Publishers: {publishers.join(" · ")}</p>
          </Reveal>
        </Container>
      </section>
    </div>
  );
}
