# CivicProof — Build India Tour submission

**One sentence:** CivicProof turns a photograph of a broken road into an evidence-backed case that says exactly what the official records establish, what they do not, and what would settle the difference — and refuses to guess in between.

**Repository:** https://github.com/SiddhanthKapoor/civicproof
**Live URL:** **Not yet deployed.** The one remaining external step is set out under “Deployment status” below. This line carries the served URL once `./scripts/deploy.sh` has run; it is deliberately not filled in with anything else.
**Video:** **Not yet recorded.** The demo flow it follows is set out under “Demo flow” below.

---

## The problem

A citizen reports a pothole. The report disappears into a grievance queue. Nobody establishes the one thing that decides what happens next: **which public-works contract covers that stretch of road, and is anyone still obliged to repair it.**

That answer exists, in public records — PMGSY/OMMAS scheme reports, tender and award documents, completion records, audit reports. It is scattered across portals, printed in table dumps, and effectively unreadable at the moment a citizen needs it.

There is also a failure mode worth naming: in September 2026 a Bengaluru road-contracts site was taken offline after its scraper attached contractor names to the wrong tenders. Naming the *wrong* contractor is worse than naming none. That incident shaped this product's central rule.

## What CivicProof does

Connects a field report to a verified government project, reconstructs the contractual obligations from official records, and states what the evidence establishes — and what it does not.

**The central safety property:** no model-authored content becomes a verified fact or enters an official complaint unless it passes deterministic verification. A model reads and proposes; code decides.

## How it works

1. **A report** — a pin, a photograph, a description, optionally the work number on the project board.
2. **Identity, identifier-first.** A work number is looked up *exactly* against a registry index built from the corpus (778 of 779 projects carry one). Case and separators are normalised; look-alike characters are never guessed at; there is no fuzzy matching. 53 codes match more than one project (`KN0204` matches 13) — those yield `CODE_MATCHES_MULTIPLE_PROJECTS`, and a person chooses. With no code, the location only *suggests* candidates; identity is established only once the project's own `project_id` is confirmed word for word in a document from that project's own bundle. Otherwise: **UNVERIFIED**, and nothing downstream runs.
3. **Facts from records.** The agent reads the project's documents and proposes claims. The verifier accepts one only if the quotation appears on the cited page *and* contains the stated value. Fabricated citations are rejected and the claim's origin is demoted.
4. **Conflicts and units.** Values normalise into typed quantities, so `12 months` and `1 year` are one fact while `12.5 million` and `12.5 crore` are a conflict that is surfaced rather than silently merged. A figure with no unit is its own kind and can never pass as a cost.
5. **The defect-liability window** is arithmetic over a *physical* completion date and a stated period, resolved by the nearest label in the source rather than by position — UNKNOWN when the labels do not settle it. A model-authored window is discarded outright.
6. **Four independent determinations**, all derived by plain code: identity, contractual status, field condition, scope relationship — plus an overall state that is an ordered rule table over the last three, total across all **108** combinations.
7. **A complaint or RTI draft** assembled only from verified facts with their citations. Nothing is filed with any authority; CivicProof drafts and tracks.

## Architecture

Next.js 16 on AWS Lambda behind a Function URL in `RESPONSE_STREAM` mode, so the investigation streams to the browser as it happens. Strands Agents drives the loop; **Cedar** policies are evaluated before every tool call; **Amazon Bedrock** (Nova Pro, `apac.amazon.nova-pro-v1:0`) takes over mid-run if Gemini hits its quota, reconstructing provider-neutral state rather than replaying a transcript; **DynamoDB** stores cases, **S3** stores photographs, packet PDFs and an archive of every record the agent fetches live (URL, retrieval time, SHA-256); **Textract** OCRs scanned uploads; **Amazon Location** resolves the road at a pin; **CloudWatch** carries per-run metrics including the share of the model's claims the verifier accepted.

A deterministic **rules planner** implements the same `Model` interface, so the whole product runs end to end with no language model at all — which is also how the test suite and the evaluation run.

## Evidence and provenance

Every fact carries its document, page, verbatim quotation, source URL, retrieval date and content hash. `npm run ingest` re-verifies **all 7,622 facts** against their sources on every build and fails the build if one drifts. A judge can falsify the entire data claim with one command.

> **What re-verification depends on.** That guarantee holds for a checkout that has the source documents. **6,826 of the 7,622 facts (89.6%) cite one of the 18 OMMAS documents whose licence restricts republication**, so how this repository is released decides whether a fresh clone can re-verify them. `npm run ingest` is explicit about it: a source that is absent is named, the facts citing it fail to verify rather than being assumed good, and the build stops. See [PUBLIC_RELEASE.md](PUBLIC_RELEASE.md).

**Corpus:** 26 public documents · 853 pages · **7,622 reference facts** · 779 projects (128 with official map alignments) · plus 4,729 BBMP work orders and payments for 2025-26 as a searchable dataset.

## Evaluation — with its denominators

```
npm run eval
Linked correctly: 130/130 · Reference facts recovered as verified: 1,317/1,317 (100%)
Claims not accepted by the verifier: 0 · Cedar/guard denials: 0 · Runs that errored: 0
Scope: 130 of 779 projects (17%) and 1,317 of 7,622 reference facts (17%).
This is a deterministic replay of curated extractions through the real agent loop, Cedar
policies and verifier — a corpus-integrity and pipeline check, not a measure of model accuracy.
```

The harness probes each project with a synthetic pin, which only works where a project has a mapped alignment — hence the subset. **There is no whole-corpus accuracy figure and none is claimed.** The run fails with a non-zero exit below its thresholds, so a catastrophic result cannot pass silently.

**Tests:** 155 unit and integration tests across 19 files, plus 5 browser tests including an axe WCAG 2.1 AA audit that reports no violations.

## The human-review boundary

`POTENTIAL_ISSUE` and `HUMAN_REVIEW` both route to a person. CivicProof establishes what the records support; it does not decide who is responsible. No determination, complaint or packet asserts that a contractor caused a defect, is at fault, was negligent or is liable — a test asserts that none of the 108 outcomes contains such language. An open maintenance period is a fact about a contract, and the product says exactly that and nothing stronger.

## Demo flow

1. Open a seeded case — **Kodathi**: identity VERIFIED from the work number confirmed in the project's own OMMAS record, maintenance period ACTIVE to 2027-03-05, damage observed, scope possibly within the contract → **POTENTIAL ISSUE · human review required**, 7 of 7 records on file.
2. Open **Thimmaiah**: a defect-liability clause is on file but no verified completion date → contractual status **UNKNOWN** → overall **UNKNOWN**, with the missing record named and an RTI draft that asks for exactly it. A visible defect does not create a contract.
3. Open **Lavelle Road**: a project sits at that location but its records never state a work identifier → **project not established**, and the complaint declines to name it.
4. File a report with the work number `KN0204`: 13 projects carry it → **CODE_MATCHES_MULTIPLE_PROJECTS**, candidates listed nearest-first, nothing chosen on the reporter's behalf.
5. Click any fact to land on the page of the source document with the quotation highlighted and a "found verbatim" banner.

## Reproduce locally

```bash
npm install
npm run ingest   # 26 documents, 853 pages, re-verifies 7,622 facts, fails on drift
npm run seed     # six labelled demo reports, including the golden cases above
npm run dev      # http://localhost:3000
```

Everything is optional in `.env.local`: with no variables set the app runs on a local JSON store, local file blobs and the rules planner — no AWS account, no model key, no network.

## Safety, privacy and public release

- Contractors' mobile numbers have been removed from the committed BBMP and KPPP sources (4,729 in total); the manifest records the redaction and the hashes are of the redacted files. The redaction removed only digit runs, so the eleven Bengaluru work orders now carried as projects quote text that is unchanged by it.
- Reporter names, contact details and saved packets are owner-key-only and are stripped from every public projection.
- Photograph EXIF is stripped from the stored image.
- No secrets exist in the working tree or in git history.
- The OMMAS exports carry NRIDA's restriction on republication; the repository's publication status is handled deliberately — see `docs/PUBLIC_RELEASE.md`.

## What I learned

- **"The model proposes, code verifies" is worth more than any amount of prompting.** Live Gemini runs produced three failures no prompt would have caught: it recorded a *financial* completion date as the completion date, dropped units to get a value past the verifier, and asserted facts with no value at all. Each is now a deterministic gate with a regression test, and each was found by running the thing rather than reasoning about it.
- **Conservatism has to be designed, not hoped for.** Making UNKNOWN a first-class outcome meant accepting that the flagship demo case reads UNKNOWN without a vision model, and that one project of 779 can never be identified because its records simply never state a work number. Both are correct answers, and leaving them correct was harder than making them look good.
- **Running Next.js on Lambda with response streaming** required a Function URL rather than API Gateway or Amplify — both cap or buffer in ways that would have killed the live investigation trace. The constraint came from reading the service limits, not from a diagram.
- **Ambiguity is the common case, not the edge case.** 53 PMGSY package numbers are shared across blocks. A design that assumed an identifier was unique would have quietly attributed work to the wrong road — which is precisely the harm that took that Bengaluru site offline.

## Known limitations

Listed in full in the README. The material ones: coverage is Bengaluru and five surrounding districts, not nationwide; the evaluation covers 17% of the corpus and is a deterministic replay; the photograph gate checks technical usability, not image quality; `DEFECT_OBSERVED` needs a vision model or the labelled demo fixture; submission is manual because no government filing API is available.

## Deployment status

The application is built to deploy with `./scripts/deploy.sh` (AWS SAM, `infra/template.yaml`, validated). The remaining external step is recorded in `docs/DEPLOY.md`: AWS credentials on the deploying machine and Bedrock model access enabled for `apac.amazon.nova-pro-v1:0` in the target region. **Until the live URL above is filled in with a URL that actually serves, this project should not be described as deployed.**
