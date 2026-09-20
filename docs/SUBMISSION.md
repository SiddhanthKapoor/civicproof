# CivicProof — Build India Tour submission

**One sentence:** CivicProof turns a photograph of a broken road into an evidence-backed case that says exactly what the official records establish, what they do not, and what would settle the difference — and refuses to guess in between.

**Repository:** https://github.com/SiddhanthKapoor/civicproof
**Live URL:** **https://gzsydwsdj32igzrbxprwl6ba7y0oyzif.lambda-url.ap-south-1.on.aws/** — deployed in `ap-south-1`, stack `civicproof`. It serves, and the seven demo cases are in the deployed DynamoDB table. Read the constraints under “Deployment status” before demoing it.
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

Next.js 16 on AWS Lambda behind a Function URL in `RESPONSE_STREAM` mode, so the investigation streams to the browser as it happens. Strands Agents drives the loop; **Cedar** policies are evaluated before every tool call; **Amazon Bedrock** (Nova Pro) is wired as the mid-run fallback and tested locally, but is **switched off in this deployment** because the account cannot yet invoke Bedrock; when Gemini's quota runs out the deterministic rules planner finishes the run and the case says so.

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

**Tests:** 219 unit and integration tests across 20 files, plus 12 browser tests including an axe WCAG 2.1 AA audit that reports no violations.

## The human-review boundary

`POTENTIAL_ISSUE` and `HUMAN_REVIEW` both route to a person. CivicProof establishes what the records support; it does not decide who is responsible. No determination, complaint or packet asserts that a contractor caused a defect, is at fault, was negligent or is liable — a test asserts that none of the 108 outcomes contains such language. An open maintenance period is a fact about a contract, and the product says exactly that and nothing stronger.

## Demo flow

Seven labelled demo cases, each showing a different state the evidence can be in. `npm run seed`
checks every one against the determination it is meant to demonstrate and **fails** if one comes out
differently, so the states are derived rather than arranged.

| | Case | What the evidence does | Outcome |
|---|---|---|---|
| **A** | Potholes along the **Kodathi–Mullur** road | Work number confirmed in the project's own OMMAS record; agency, contractor, completion date (05-03-2022) and a five-year period all verified; period **ACTIVE** to 2027-03-05; usable photograph showing a defect; documented scope covering this road; 7 of 7 records on file | **POTENTIAL ISSUE · human review required** |
| **B** | Potholes on **Thimmaiah Road** | Project and scope established from a tender document, defect plainly visible — but no completion date is on file | period **UNKNOWN** → **UNKNOWN**, the missing record named and an RTI draft that asks for exactly it |
| **C** | Broken surface in **Ward 119** | One BBMP ward job number (`119-23-000003`) covers the civil work, its design report and its supervision contract, under three different contractors | **CODE_MATCHES_MULTIPLE_PROJECTS** → **UNVERIFIED**, all three candidates offered, none chosen |
| **D** | Broken surface on the **Boodihal–Channahalli** road | Completion (01-06-2021) and a five-year period both on record → the window closed 2026-06-01, before this report | period **EXPIRED** → **SUPPORTED**, stated without becoming a finding against anyone |
| **E** | Potholes in **BTM Layout** | The work number entered matches exactly one BBMP ward work order, which records the ward, work and contractor but no dates | period **UNKNOWN** → **UNKNOWN**, from a different register than B |
| **F** | **Hebbagodi–Hulimangala** road | Obligations established and still open, but no photograph was submitted | field condition **INSUFFICIENT_EVIDENCE** → **UNKNOWN**; paperwork alone does not conclude |
| **G** | Broken paving on **Lavelle Road** | The location does suggest a project and facts about it verify — but its record carries no work identifier to confirm against | **project not established**; the complaint declines to name it |

A and D carry a saved complaint packet. Click any fact on any of them to land on the page of the
source document with the quotation highlighted and a "found verbatim" banner.

### The run order

One path, three screens, no detours. `npm run seed` prints an owner key per demo case; steps 17–18
need one, because recording a submission is something only the reporter can do.

| Screen | Steps | What to point at |
|---|---|---|
| Home | 1–2 | **See it work** — seven cases, seven outcomes. Open case **A**. |
| Case A | 3 | **How this was investigated** → *Run again* streams the agent's tool calls, and the evidence above fills in as facts are verified. |
| Case A | 4–12 | The panels top to bottom: project identification · contractor · contract · defect liability (the arithmetic and all five inputs) · photograph · scope · **What the evidence establishes** · **Why it matters** · every fact linking to the page it is quoted from. |
| Packet | 13–16 | **Complaint packet** → the draft built only from verified facts, then **Where to submit**: authority, official channel, method, and *Open official portal*. The portal is opened, signed into and submitted by the citizen; CivicProof answers no CAPTCHA. |
| Case A | 17 | Paste the owner key into **Tracking**, record the submission and its reference number → the case moves *Ready for submission* → **Submitted by citizen**. Nothing moves it without that confirmation. |
| Case A | 18 | Add a follow-up photograph or the authority's reply under Tracking; both are kept as dated evidence and appear on the timeline in the order they happened. |

Then open **D** for the same chain with an expired period, and **C** for an identifier three works
share. Together they are the argument: the outcome changes because the records do.

Every demo case is flagged `demo` in the schema, shows a visible pill, and states on the page what it
is there to demonstrate. Cases A–E carry a fixture image — generated noise, labelled as such, never
presented as a photograph — and a recorded observation labelled a demo fixture, so the
defect-observed path is reachable with no vision model. Neither can become a verified fact or enter a
complaint.

## Reproduce locally

```bash
npm install
npm run ingest   # 26 documents, 853 pages, re-verifies 7,677 facts, fails on drift
npm run seed     # the seven labelled demo cases above; --reset rebuilds them in place
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

Deployed with `sam deploy` from `infra/template.yaml` into `ap-south-1` (stack `civicproof`).

**Verified against the running deployment, not inferred:**

| | |
|---|---|
| `/api/health` | `{"ok":true,"store":"dynamodb","blobs":"s3","planner":"gemini"}` · 26 documents, 853 pages, 790 projects |
| Google Gemini in production | a live investigation on the Kodathi–Mullur case completed **on the deployment** in 143 s with `gemini-3-flash-preview`: 12 facts verified against the pages they cite, the financial completion date correctly kept out of `completion_date` |
| Secrets Manager | the Gemini key is held as a stack secret and read by the function's role at run time; it is not in the bundle, the repository or the function's environment |
| DynamoDB | the 7 demo cases seeded into `civicproof-CasesTable-…`, each producing the determination it exists to demonstrate |
| S3 | photographs stored and served through `/api/media/…` (200, `image/png`) |
| Lambda Function URL | response streaming confirmed: a live investigation returned 20 trace events, 11 claims and a completed run as NDJSON in 2.5 s |
| Amazon Location | reverse geocode at the report pin returned a real address in 0.26 s |
| CloudWatch | 12 EMF metrics in the `CivicProof` namespace; the run recorded `VerifiedFacts=11`, `VerifiedShare=100`, `PolicyDenials=0`. Dashboard `civicproof-investigator` |
| Fail-closed in production | a report with no photograph came back `INSUFFICIENT_EVIDENCE` → overall `UNKNOWN` |
| Browser suite against the live URL | 14 of 16; the two that failed pass on their own (see the ceiling below) |

**What is not working, and why — all one cause.** The AWS account is still being verified by AWS. Until that completes it cannot invoke Bedrock (`Operation not allowed`), is not subscribed to Textract, cannot create CloudFront distributions (`Your account must be verified before you can add new CloudFront resources`), and runs with a **Lambda concurrency ceiling of 10** instead of the default 1000. That ceiling is an account restriction, not a quota: Service Quotas refuses a request below the default of 1000.

**What the ceiling means in practice.** Every request to a Function URL is a Lambda invocation, including each of the ~20 hashed chunks a page asks for. One visitor loading the site cold was measured at **20/20 assets HTTP 200** — it works. Concurrent load does not: 15 simultaneous requests returned 12 × 429, and 169 throttles were recorded in half an hour of testing. **One person demoing it is fine. Several at once is not.**

**The fix is written and waiting on verification.** `infra/template.yaml` carries a `Cdn` parameter that puts CloudFront in front of the Function URL and serves `/_next/static` from the edge, taking those ~20 invocations per page load off the function. It defaults to `off` because a stack that cannot be created is worse than one missing an optimisation. Once AWS confirms the account:

```bash
sam deploy -t infra/template.yaml --stack-name civicproof --region ap-south-1 \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset \
  --parameter-overrides Planner=bedrock Cdn=on      # add GeminiApiKey=… for the Gemini path
```

Since 20 September the deployment runs **Google Gemini** as the investigator (`Planner=gemini`, key in Secrets Manager). Amazon Bedrock stays switched off because this account still cannot invoke it, so `FallbackToBedrock=false`: when Gemini's free-tier quota runs out, the run is finished by the deterministic rules planner and the case page says exactly that. The `Cdn=on` flag remains available for CloudFront once verification completes.

**Security note on the deploying identity.** The IAM user used here holds `AdministratorAccess` with a long-lived access key. That is broader than a deploy needs and should be rotated or removed after the hackathon; the Lambda's own role is least-privilege and is defined in the template.
