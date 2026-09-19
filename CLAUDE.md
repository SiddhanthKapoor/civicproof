@AGENTS.md

# CivicProof — Claude Code Instructions

This file has two parts:

* **Part I — Project Reference & Operating Rules.** What this repository is, its current verified state, and the concrete rules for working in it day to day (commands, secrets, data policy, regressions not to reintroduce).
* **Part II — Engineering & Ship-It Mission.** The mandate, priorities, and process for taking CivicProof to a deployed, hackathon-ready product.

Where the two overlap, Part I governs the mechanics of this repository (exact commands, file paths, dataset facts, privacy rules) and Part II governs scope, priority, and product judgment. Where they genuinely conflict, apply the stricter rule and report the conflict rather than choosing silently.

---

## THE GOLDEN CONSTRAINT — read this before changing anything

**Whenever you build something here, keep the existing feature, architecture, UI or design wherever it already meets or exceeds the requirement you are working to.** Replace only what is demonstrably worse than the requirement, or demonstrably broken.

This applies to every requirement document, specification, checklist or brief you are given, including ones written after this file. A new spec describes a *target*, not a mandate to rebuild: compare the existing implementation against it first, and keep what already wins.

Before you change any existing component, decide and record which of these applies:

| Verdict | Meaning | Action |
|---|---|---|
| **PRESENT AND STRONGER** | The existing code does more, or does it more safely, than the requirement asks | **KEEP.** Do not touch it. Note why it is stronger so it is not lost later. |
| **PRESENT** | It meets the requirement | **KEEP.** |
| **PARTIAL** | It meets part of the requirement | **EXTEND** the existing code. Do not write a parallel implementation. |
| **BROKEN** | It fails its own tests or produces wrong output | **FIX** it, with a regression test for the failure mode. |
| **MISSING** | Nothing covers it | **ADD**, integrated into the existing flow. |

Rules that follow from this:

- **"I would have written it differently" is not a reason to rewrite.** Neither is unfamiliarity, naming style, file layout, or a preference for a different library or pattern.
- **Never build a second system beside a working one.** If a determination engine, verifier, identity resolver, evidence ledger, packet builder or policy layer already exists, extend it. Two sources of truth for the same fact is a defect, not a migration path.
- **Preserve passing tests.** A test that fails after your change is a regression until proven otherwise — prove it by reproducing the failure on the unmodified code before calling it pre-existing.
- **Preserve working UI.** Existing layout, components and copy stay unless the requirement cannot be met without changing them. When you do change a working surface, say so explicitly in your report so it can be vetoed.
- **State the trade-off out loud.** If a requirement, read literally, would weaken something the existing code does better — evidence integrity, fail-closed behaviour, privacy, accessibility — say so and recommend against it rather than implementing it silently.

When in doubt, the smaller change that preserves working behaviour is the right one.

---

# PART I — PROJECT REFERENCE & OPERATING RULES

## Project: CivicProof

CivicProof is a civic-report investigation and verification system. It uses government records, geospatial information, document extraction, and AI-assisted investigation to connect citizen reports with relevant public works and verify factual claims.

## Current Project State

The project has been end-to-end tested locally.

* 59 unit tests pass.
* All 5 browser tests pass, including accessibility testing.
* Browser tests pass against both the development server and production build.
* The rules-planner evaluation links all 130 mapped projects correctly and recovers all 1,317 reference facts.
* Gemini has been tested against a real report and successfully:

  * identified a PMGSY road by name despite the absence of a mapped road line;
  * linked it to PMGSY-I package `KN0204`;
  * verified five facts;
  * identified the contractor and completion date;
  * routed the complaint to the appropriate Bengaluru Rural PMGSY office.
* AWS integrations are implemented and validated against local stand-ins. Do not assume that AWS resources are deployed or credentials are available locally.

## Important: Do Not Expose Secrets

Never commit, print, log, or expose:

* Gemini API keys
* AWS access keys or secret keys
* AWS session credentials
* credentials stored in `.env.local`
* Secrets Manager secret values
* authentication tokens
* private user data

The Gemini key is expected to be provided through `.env.local` during local development and through AWS Secrets Manager in deployment.

## AWS Architecture

The production architecture uses:

* **Amazon Bedrock / Amazon Nova** — fallback model when Gemini fails or reaches quota limits, while preserving investigation progress.
* **AWS Secrets Manager** — stores the Gemini API key. Lambda/functions must have access only to the required secret.
* **Amazon Location Service** — address search and road-name lookup at report coordinates.
* **Amazon S3** — stores photos, PDFs, and an archive of records fetched by the agent, including source URL, retrieval time, and hash.
* **Amazon CloudWatch** — per-run metrics and dashboard, including:

  * verifier acceptance share;
  * policy denials;
  * rate-limit waits;
  * investigation duration.
* **Amazon Textract** — document extraction.
* **Amazon DynamoDB** — application data.
* **AWS Lambda** — serverless execution.
* **AWS SAM** — infrastructure definition and deployment.

The SAM template must remain valid after changes.

Do not replace Amazon Nova with Anthropic models unless explicitly requested.

## AI / Investigation Rules

The investigation system must preserve work already completed when a model fails.

If Gemini:

1. reaches a rate limit,
2. receives repeated transient `503` responses,
3. exhausts its daily quota, or
4. otherwise becomes unavailable,

the investigation must not discard completed work.

In AWS, Amazon Nova should continue the investigation.

In local development, the rules planner may complete the investigation without requiring another model.

The case UI must accurately record when a fallback occurred and which model completed the work.

### Rate Limits

Rate-limit handling is intentional behavior.

The system should:

* wait rather than immediately fail;
* expose waits in the live trace;
* distinguish temporary model unavailability from a fatal investigation error;
* preserve all previously verified facts;
* continue with the configured fallback where available.

Do not remove rate-limit waits merely to make tests faster.

## Evidence and Facts

Every reference fact must be traceable to its source.

Facts should:

* quote the source accurately;
* preserve the source's original meaning and units;
* retain provenance;
* be re-checked during builds where required;
* never be silently altered merely to make a verifier accept them.

Do not:

* drop units from measurements;
* convert a financial completion date into a project completion date;
* manufacture facts;
* treat differently formatted representations of the same fact as contradictory without semantic evidence of a conflict.

When two records represent the same underlying fact in different formats, normalize them before declaring a conflict.

## Public Records and Privacy

CivicProof uses public-sector records, but public availability does not automatically mean every field should be exposed publicly.

Never expose personal contact information unnecessarily.

In particular:

* contractor phone numbers have been intentionally removed from the BBMP dataset;
* private/personal mobile numbers must not appear on public-facing records pages;
* newly ingested datasets must be checked for personal information before being exposed through the application.

If a source contains sensitive personal information that is not required for the civic investigation, exclude it from the public-facing dataset.

## OMMAS Data and Repository Policy

### Current private-repository policy

The repository currently contains 16 exported files obtained from the Government of India's OMMAS/PMGSY system.

These files may remain in the repository **while the repository is private**, subject to the project's applicable legal and source-use constraints.

Do not:

* publish the repository containing those exports;
* upload the exports to a public artifact store;
* redistribute the exports independently;
* assume that because the information is publicly accessible, republishing the downloaded reports is unrestricted.

### Before making the repository public

**Do not make the repository public while the OMMAS exports are committed to it.**

Before any public release:

1. Remove the committed OMMAS exports.
2. Replace them with a reproducible build-time download mechanism.
3. The downloader must retrieve the required reports directly from the official OMMAS source.
4. Do not commit downloaded OMMAS report contents to Git.
5. Do not place downloaded OMMAS reports into publicly accessible build artifacts unless their redistribution is permitted.
6. Document the source URLs and retrieval process.
7. Respect OMMAS's applicable legal notices, terms, robots/access restrictions, and rate limits.
8. Fail clearly if a required source cannot be downloaded rather than silently substituting stale or fabricated data.
9. Cache downloaded files only in local/build-time storage where appropriate.
10. Keep generated source data out of Git using `.gitignore`.

The preferred long-term public-repository architecture is therefore:

```text
Git repository
    |
    +-- source metadata / download manifest
    |
    +-- build-time downloader
    |
    +-- official OMMAS source
    |
    +-- local build cache
    |
    +-- generated application dataset
```

Do not commit the generated OMMAS exports.

### Build-time downloader requirements

If implementing the downloader:

* use official OMMAS URLs only;
* make the source URLs configurable;
* use reasonable request throttling;
* identify the application appropriately where required;
* verify downloaded content;
* fail loudly on HTTP errors or unexpected content;
* record retrieval timestamps;
* avoid unnecessarily downloading the same source repeatedly;
* never bypass CAPTCHAs or other access controls;
* never attempt to circumvent technical restrictions imposed by the source.

If OMMAS changes its interface or blocks automated retrieval, stop and require an explicit implementation decision rather than attempting to circumvent the restriction.

## Data Provenance

For records fetched by the agent, retain:

* source URL;
* retrieval timestamp;
* content hash;
* relevant record metadata.

S3 archives should preserve this provenance.

The application should make it possible to distinguish:

1. the original government source;
2. the retrieved record;
3. the normalized fact extracted from that record;
4. the AI's interpretation of that fact.

Never represent an AI-generated inference as though it were directly stated by a government source.

## Geospatial / Project Data

The current project dataset contains:

* 779 projects;
* 7,622 reference facts;
* PMGSY rural-road projects across:

  * Bengaluru Rural;
  * Ramanagara;
  * Chikkaballapura;
  * Kolar;
  * Tumakuru.
* 128 roads currently have official map lines.
* BBMP contains 4,729 work orders/payments for 2025–26.

The agent must be able to:

* find roads by name when a map line is unavailable;
* search the government's PMGSY/OMMAS portal live for Karnataka districts;
* use Amazon Location Service for address/road-name resolution where deployed.

Do not treat absence of a map line as evidence that a road does not exist.

## State Procurement Portal

The state procurement portal currently uses a CAPTCHA-protected search interface.

Do not attempt to bypass or defeat the CAPTCHA.

If automated retrieval is required in the future, use an officially supported API, export mechanism, or other permitted interface.

## BBMP Data

BBMP work-order and payment data is public-domain data used by CivicProof.

Contractor phone numbers must remain excluded from CivicProof's public dataset.

If the upstream source changes, preserve this privacy rule during ingestion.

## PWA Requirements

CivicProof is a Progressive Web App.

Maintain:

* installability;
* service-worker functionality;
* offline access for pages/resources that have already been opened;
* successful Chrome installability checks.

Any changes to service workers, caching, manifests, or routing must be retested in a production build.

## Case State Management

An interrupted investigation must never remain permanently stuck in `running`.

Every run must have a recoverable terminal or retryable state.

If execution is interrupted:

* the case must eventually become retryable;
* previously completed work must be preserved;
* the user must have a way to re-run the investigation;
* the UI must not falsely imply that an active process still exists.

Test interrupted runs whenever changing investigation orchestration.

## Testing Requirements

Before considering a change complete, run the relevant test suite.

At minimum, preserve:

* all 59 unit tests;
* all 5 browser tests;
* accessibility testing;
* tests against the development server;
* tests against the production build;
* the rules-planner evaluation.

Changes affecting data ingestion should also verify project/fact counts and provenance.

Changes affecting AI verification should include regression coverage for:

* equivalent fact formats;
* units;
* project completion dates vs financial completion dates;
* model fallback;
* rate-limit waits;
* quota exhaustion;
* interrupted runs.

## Local Development

Start the application with:

```bash
npm run dev
```

Local Gemini configuration is read from:

```text
.env.local
```

Never commit `.env.local`.

The repository may contain unrelated local processes. Do not kill or modify unrelated services unless explicitly requested.

## AWS Deployment

Deployment is performed with:

```bash
./scripts/deploy.sh
```

Do not assume deployment has succeeded merely because the SAM template validates.

Before deployment:

1. Confirm AWS credentials are available.
2. Confirm the target AWS account and region.
3. Confirm Amazon Nova / Bedrock model access is enabled.
4. Validate the SAM template.
5. Confirm required permissions exist.
6. Confirm the Gemini secret exists in Secrets Manager.
7. Deploy.
8. Run production smoke tests.
9. Verify CloudWatch metrics and dashboard.
10. Verify the public URL.

Never commit AWS credentials to the repository.

## Ship It / Public Demo

The Ship It track requires a live URL.

A deployment is not considered complete until:

* the application is publicly reachable;
* the production build works;
* the PWA is installable;
* the investigation flow works end-to-end;
* Gemini fallback to Amazon Nova is verified;
* Secrets Manager access works;
* S3 record archiving works;
* Location Service lookup works;
* CloudWatch metrics are emitted;
* no private credentials or personal information are exposed.

## Git Hygiene

Before committing:

* inspect `git diff`;
* inspect `git status`;
* ensure `.env.local` and credentials are excluded;
* ensure generated OMMAS exports are excluded once the repository moves toward public release;
* ensure no personal phone numbers or other unnecessary personal data are committed;
* do not commit build caches or temporary downloaded source files.

## Important Existing Fixes

Do not regress these previously fixed issues:

1. Private tender-officer mobile number appearing on a public records page.
2. Accessibility contrast failure hidden by page animations.
3. Interrupted investigations remaining permanently in `running`.
4. Equivalent facts being incorrectly treated as conflicts.
5. Financial completion dates being incorrectly interpreted as project completion dates.
6. Units being removed from facts to satisfy verification.
7. Loss of investigation progress after Gemini quota/rate-limit failure.

## Change Philosophy

Prefer small, testable changes.

When modifying the investigation pipeline:

1. preserve provenance;
2. preserve completed work;
3. preserve privacy boundaries;
4. preserve fallback behavior;
5. preserve accessibility;
6. add regression tests for the failure mode being fixed.

Do not weaken verification, privacy, or source-provenance rules merely to make a demo pass.

---

# PART II — ENGINEERING & SHIP-IT MISSION

## Mission

You are the lead engineering team responsible for taking the existing CivicProof repository to a production-quality, AWS-deployed, hackathon-ready product for the **WeMakeDevs × AWS First Commit / Bharat Builds Tour 2026 — Ship It track**.

This repository already contains substantial working functionality.

**Do NOT rebuild CivicProof from scratch.**

The existing frontend works well, the application has already been tested end-to-end, and substantial data, AI, PWA, testing, and AWS-local-stand-in work already exists.

Your responsibility is to:

1. Understand the existing codebase completely.
2. Preserve working functionality.
3. Compare the existing implementation against the intended CivicProof architecture and product vision.
4. Identify the strongest features from both.
5. Keep the best existing implementation wherever it is already superior.
6. Add only the missing capabilities that materially improve CivicProof.
7. Harden reliability, evidence integrity, security, and UX.
8. Connect the existing system to real AWS services.
9. Deploy the product.
10. Test the deployed product end-to-end.
11. Prepare the application, repository, and demo for the hackathon.

The result must feel like **one coherent product**, not a rewritten application or two systems glued together.

---

# 1. HACKATHON OBJECTIVE

Optimize the product for the official judging dimensions:

1. Idea & Impact
2. Built on AWS
3. Learning
4. Execution
5. Demo Video

For Ship It, the product must be genuinely deployed and AWS architecture must be meaningful.

Prioritize:

* real-world usefulness,
* clear user value,
* genuine AWS usage,
* reliable execution,
* technical depth,
* evidence integrity,
* explainability,
* excellent UX,
* responsible AI,
* compelling demonstration.

Do NOT optimize for:

* feature count,
* number of AWS services,
* number of AI calls,
* unnecessary architecture,
* buzzwords,
* code volume.

The core principle is:

> **One excellent reliable workflow is better than five incomplete features.**

---

# 2. CORE CIVICPROOF VISION

CivicProof is an evidence-chain engine for public works.

Core promise:

> **Connect physical evidence from a public-works site to a verified government project, reconstruct contractual/project obligations from official records, determine what the available evidence actually establishes, and explicitly identify what remains unknown.**

Core principles:

> Evidence before conclusion.

> AI interprets; deterministic code verifies.

> Never turn an evidence gap into a guess.

> CivicProof doesn't accuse. It establishes.

CivicProof should NOT become:

* a generic AI chatbot,
* an AI pothole detector,
* an AI complaint generator,
* a corruption detector,
* a contractor reputation/ranking system,
* an autonomous government complaint-submission system,
* a generic dashboard.

The **evidence chain** is the product.

---

# 3. EXISTING IMPLEMENTATION — PRESERVE IT

The existing application has substantial working functionality.

Current reported state:

* 59 unit tests passing
* 5 browser tests passing
* accessibility audit passing
* development-server tests passing
* production-build tests passing
* SAM template validates
* PWA is installable
* previously deployed frontend works
* real Gemini tests have been performed
* AWS components have been tested against local stand-ins
* 779 projects
* 7,622 reference facts
* 130 mapped projects
* 1,317 reference facts recovered by evaluation
* 4,729 BBMP work orders/payments for 2025–26
* PMGSY road records across Bengaluru Rural, Ramanagara, Chikkaballapura, Kolar and Tumakuru
* 128 roads with official map lines

Do not assume this information is still true after modifying the repository.

Always rerun the relevant tests after changes.

---

# 4. DO NOT REBUILD THE FRONTEND

The existing website works well.

**Preserve the existing frontend and UX wherever possible.**

Do NOT rewrite the frontend simply because a different architecture was proposed previously.

Keep existing:

* good visual design,
* useful interactions,
* existing case workflow,
* useful maps,
* working components,
* useful data displays,
* PWA behavior,
* demo functionality.

Only change frontend code when:

1. a concrete product problem exists,
2. a security/accessibility/reliability issue exists,
3. a missing CivicProof capability requires it,
4. or a change materially improves the judge-facing experience.

Prefer:

> extend → integrate → polish

over:

> rewrite.

---

# 5. FIRST ACTION — AUDIT BEFORE CODING

When starting from this CLAUDE.md:

**DO NOT immediately rewrite or restructure the code.**

First inspect:

* repository structure,
* README,
* package.json,
* source code,
* frontend,
* backend,
* APIs,
* database,
* AI integrations,
* AWS integrations,
* SAM infrastructure,
* PWA configuration,
* tests,
* prompts,
* data,
* deployment configuration,
* environment configuration,
* Git history.

Understand what already works.

Then use multiple independent agents/subagents in parallel for analysis.

---

# 6. PARALLEL AGENT AUDIT

Use parallel agents where tasks are independent.

Do NOT allow multiple agents to simultaneously modify the same critical files.

Run these audits in parallel:

## Agent 1 — Architecture

Inspect:

* application architecture,
* data flow,
* backend,
* API structure,
* state management,
* database,
* AWS architecture,
* SAM.

Identify:

* strengths,
* unnecessary complexity,
* missing pieces,
* architectural risks.

Do not modify code.

---

## Agent 2 — Frontend / UX

Inspect:

* visual design,
* responsiveness,
* accessibility,
* case flow,
* report flow,
* maps,
* evidence presentation,
* demo experience,
* mobile/PWA behavior.

Identify:

* strengths worth preserving,
* high-impact UX improvements,
* confusing flows,
* demo risks.

Do not redesign unnecessarily.

---

## Agent 3 — AI / Evidence Integrity

Inspect:

* Gemini integration,
* Bedrock/Nova fallback,
* prompts,
* model outputs,
* fact verification,
* source provenance,
* conflict handling,
* unknown states,
* hallucination risks.

Pay particular attention to:

* completion dates,
* duplicate fact formats,
* units,
* unsupported claims,
* model fallback.

---

## Agent 4 — AWS / Security

Inspect:

* Lambda,
* S3,
* DynamoDB,
* Textract,
* Bedrock,
* Secrets Manager,
* Location,
* CloudWatch,
* IAM,
* SAM.

Look for:

* excessive permissions,
* public buckets,
* secret exposure,
* insecure APIs,
* unsafe uploads,
* sensitive logging,
* unnecessary AWS services.

Do not modify code during the audit.

---

## Agent 5 — Testing / Reliability

Inspect:

* unit tests,
* browser tests,
* integration tests,
* failure handling,
* retries,
* rate limits,
* stuck investigations,
* PWA,
* production build,
* race conditions.

Identify regression risks.

---

## Agent 6 — Hackathon Judge

Review the entire product as a skeptical hackathon judge.

Focus on:

* Idea & Impact,
* AWS credibility,
* Execution,
* technical depth,
* UX,
* memorability,
* demo clarity,
* evidence credibility.

Do not assign a numerical score.

Identify:

* strongest differentiators,
* weakest points,
* demo risks,
* credibility risks,
* highest-impact improvements.

---

# 7. SYNTHESIZE THE AUDIT

After the parallel agents finish, create:

`docs/final-audit.md`

Include:

## Existing strengths

## Existing weaknesses

## Features to KEEP

## Features to IMPROVE

## Features to REWRITE

## Features to REMOVE

## Missing CivicProof capabilities

## AWS gaps

## Evidence integrity risks

## Security risks

## UX risks

## Testing risks

## Demo risks

## Deployment blockers

Then create:

`docs/final-implementation-plan.md`

Prioritize work:

### P0

Security, correctness, deployment, data integrity, serious bugs.

### P1

Features or improvements with major impact on judging, reliability, or product value.

### P2

Meaningful polish.

### P3

Optional enhancements.

Do NOT implement P3 work while P0/P1 work remains.

---

# 8. CURRENT AWS ARCHITECTURE

Existing AWS services have meaningful responsibilities.

Preserve them unless a concrete audit proves a better architecture is needed.

## Amazon Bedrock

Amazon Nova is the production fallback when Gemini fails.

The objective is to continue the investigation without losing work already completed.

Do not unnecessarily replace this architecture.

---

## AWS Secrets Manager

Stores the Gemini API key.

The application must:

* retrieve it securely,
* restrict access to only the required secret,
* never expose it to the frontend,
* never log it,
* never commit it.

---

## Amazon Location Service

Used for:

* address search,
* identifying road names around a report pin,
* supporting road-record search.

Location is corroborating evidence.

It must NOT be treated as absolute proof of project identity.

---

## Amazon S3

Stores:

* photos,
* PDFs,
* source records,
* fetched-record archives.

Preserve source provenance:

* source URL,
* retrieval timestamp,
* content hash.

---

## CloudWatch

Provides:

* investigation metrics,
* verification acceptance metrics,
* policy denials,
* waits,
* duration,
* dashboard.

Preserve and improve this observability.

---

## Textract

Used for document/image text extraction.

---

## DynamoDB

Used for:

* projects,
* facts,
* cases,
* application state,
* processing state.

---

## Lambda

Used for serverless backend functionality.

---

## AWS SAM

Use the existing SAM infrastructure.

Do not migrate to CDK merely because an earlier architecture suggested CDK.

The current SAM implementation is already validated.

Prefer improving working infrastructure over replacing it.

---

# 9. REAL AWS DEPLOYMENT

The AWS implementation has currently been tested only against local stand-ins because the machine previously had no AWS credentials.

The next objective is real AWS deployment.

When AWS credentials are available:

1. verify AWS identity,
2. verify region,
3. verify required IAM permissions,
4. verify Amazon Nova / Bedrock model access,
5. verify Secrets Manager,
6. deploy SAM infrastructure,
7. deploy application,
8. run production smoke tests,
9. test all important AWS services,
10. test Gemini → Bedrock fallback,
11. inspect CloudWatch,
12. verify public URL.

Never claim deployment succeeded unless the actual deployed system has been tested.

---

# 10. AWS CREDENTIAL SAFETY

NEVER request or store AWS credentials in:

* source code,
* CLAUDE.md,
* Git,
* README,
* browser code,
* `.env` committed to Git,
* chat messages,
* logs.

Use secure AWS credential mechanisms such as:

* AWS CLI profiles,
* environment credentials,
* IAM roles,
* appropriate local credential configuration.

Never print secrets.

Never commit secrets.

---

# 11. BEDROCK / NOVA FALLBACK

The current fallback behavior is valuable and must be preserved.

Expected behavior:

Gemini fails.

↓

Investigation does NOT restart.

↓

Amazon Nova takes over on AWS.

↓

Existing verified work is retained.

↓

Already-linked project remains linked.

↓

Already-verified facts remain available.

↓

Case records that fallback occurred.

Test this with an actual production failure/fallback scenario.

---

# 12. RATE LIMITS

Existing rate-limit handling must remain intact.

The system already handles:

* per-minute limits,
* Gemini 503 high-demand responses,
* waits,
* daily quota exhaustion,
* fallback behavior.

Do not remove this behavior.

When waiting occurs, the trace should make the state understandable.

When the daily quota is exhausted:

AWS:

> continue with Amazon Nova where appropriate.

Local:

> rules planner may finish using already established evidence.

The user must be able to understand what happened.

---

# 13. PROJECT IDENTITY

Project identity should be evidence-based.

Preferred hierarchy:

1. explicit project/Job Code evidence,
2. verified project record,
3. road-name matching,
4. geographic corroboration,
5. other supporting evidence.

Do not use GPS alone as identity proof.

Do not allow an LLM to invent project identity.

If identity cannot be verified:

> UNVERIFIED

---

# 14. DATASET

Current data includes:

* 779 projects,
* 7,622 reference facts,
* 130 mapped projects,
* 1,317 reference facts recovered by evaluation,
* 4,729 BBMP work orders/payments for 2025–26,
* PMGSY roads across Bengaluru Rural, Ramanagara, Chikkaballapura, Kolar and Tumakuru,
* 128 roads with official map lines.

Preserve the working dataset.

Do not replace it with synthetic data.

Do not fabricate additional projects or facts.

Clearly communicate the geographic and source coverage.

Do not claim nationwide or universal coverage.

---

# 15. FACT PROVENANCE

Every important fact should be traceable where possible to:

* source,
* source URL,
* source document,
* retrieval date,
* source text/page where available,
* verification method,
* verification status.

Never fabricate:

* source URLs,
* source excerpts,
* page numbers,
* government facts,
* contractor facts,
* contract clauses.

---

# 16. FACT CONFLICT HANDLING

The system previously had problems where equivalent representations of the same fact were treated as conflicts.

Preserve the fix.

The system should distinguish:

### Same fact, different representation

Example:

`12 months`

vs.

`1 year`

from equivalent authoritative sources.

This should not automatically become a conflict.

### Genuine conflict

Two authoritative sources explicitly state different values.

This should be surfaced.

Do not hide genuine conflicts.

Do not manufacture conflicts from formatting differences.

---

# 17. UNITS

Never silently drop units.

Preserve:

* amount + currency,
* duration + unit,
* length + unit,
* area + unit,
* quantity + unit,
* percentage.

Example:

Bad:

`12`

Good:

`12 months`

Never modify values simply to make them pass verification.

---

# 18. COMPLETION DATE

Be extremely careful with completion dates.

Distinguish:

* physical/work completion,
* financial completion,
* payment completion,
* administrative completion,
* contract completion.

Do not treat a financial completion date as project completion unless the source explicitly establishes that meaning.

If the relevant completion evidence is unavailable:

> UNKNOWN

---

# 19. DLP

DLP logic must be deterministic.

Do not ask an LLM to calculate dates.

Use:

supported completion date
+
supported DLP duration
+
current date

to determine:

ACTIVE
EXPIRED
UNKNOWN

If required evidence is missing:

> UNKNOWN

Never guess.

---

# 20. FIELD EVIDENCE

Distinguish:

### Observation

What is visibly present?

### Cause

Why did it happen?

### Responsibility

Who caused it?

CivicProof should primarily establish observable conditions and evidence relationships.

Preferred:

> Surface deterioration observed.

Not:

> Contractor caused the deterioration.

Do not generate unsupported accusations.

---

# 21. FINAL CASE STATES

Maintain independent determinations.

## Contractual status

* ACTIVE
* EXPIRED
* UNKNOWN

## Field condition

* DEFECT_OBSERVED
* NO_DEFECT_OBSERVED
* INSUFFICIENT_EVIDENCE
* HUMAN_REVIEW

## Scope relationship

* POTENTIALLY_RELATED
* NOT_ESTABLISHED
* UNKNOWN

## Overall case

* SUPPORTED
* POTENTIAL_ISSUE
* UNKNOWN
* UNVERIFIED

Do not replace this with an opaque AI score.

---

# 22. UNKNOWN IS A FIRST-CLASS OUTCOME

If required evidence is missing:

do not infer it.

Example:

Completion evidence missing.

↓

Completion = UNKNOWN.

↓

DLP = UNKNOWN.

↓

Overall determination = UNKNOWN.

The UI should explain:

### What we know

...

### What is missing

...

### Why it matters

...

### What would resolve it

...

### Next action

...

This is a core CivicProof differentiator.

---

# 23. HUMAN REVIEW

Potential issues should support human review.

The reviewer should be able to:

* confirm,
* request more evidence,
* mark unresolved,
* close,
* add notes.

Do not automatically accuse contractors.

Do not automatically submit government complaints.

---

# 24. EVIDENCE CHAIN

The product's core visual and conceptual structure should be:

FIELD REPORT
↓
PROJECT / ROAD IDENTITY
↓
OFFICIAL RECORDS
↓
VERIFIED FACTS
↓
CONTRACT / PROJECT OBLIGATIONS
↓
COMPLETION / TIMELINE
↓
FIELD CONDITION
↓
SCOPE RELATIONSHIP
↓
DETERMINATION
↓
NEXT ACTION

Where the existing UI can support this, preserve it.

Where it cannot, improve it.

---

# 25. EVIDENCE LEDGER

Important conclusions should be traceable through:

* claim,
* evidence,
* source,
* verification status,
* method,
* relevance.

The UI should make it easy to answer:

> "Why does CivicProof believe this?"

---

# 26. EVIDENCE COMPLETENESS

If an evidence-completeness indicator exists or is added:

make clear:

> Evidence completeness is NOT a truth score or confidence score.

It means:

> How many required evidence elements are currently available?

Never present it as probability or certainty.

---

# 27. EVIDENCE GAP RESOLUTION

When evidence is missing, show:

* missing item,
* why it matters,
* what would resolve it,
* next action.

If an information request is generated:

label it:

> Draft information request — review before use.

Do not automatically submit it.

---

# 28. OMMAS DATA

The repository currently contains OMMAS exports.

The source reportedly has legal/usage restrictions concerning republication.

Treat this as a release blocker for public repository publication until the applicable terms have been reviewed.

Before making the repository public:

1. inspect the relevant source terms/legal notice,
2. identify applicable restrictions,
3. document them in `docs/data-sources.md`,
4. determine whether the committed exports may legally be redistributed,
5. if necessary, replace committed exports with a build-time retrieval mechanism ONLY if that use is permitted,
6. preserve provenance,
7. never bypass CAPTCHAs or access controls,
8. do not scrape prohibited content.

Do not make the repository public automatically.

Do not make a legal conclusion beyond what the actual source terms establish.

---

# 29. PRIVACY

A previous test discovered a tender officer's mobile number exposed on a public records page.

That was fixed.

Maintain this protection.

Before release, scan for:

* phone numbers,
* personal email addresses,
* unnecessary personal data,
* credentials,
* API keys,
* tokens,
* private URLs,
* sensitive logs.

Contractor phone numbers have already been removed.

Do not reintroduce them.

---

# 30. SECURITY

Perform a complete security audit covering:

* IAM,
* S3 permissions,
* DynamoDB permissions,
* Lambda permissions,
* Secrets Manager,
* API access,
* CORS,
* uploads,
* malicious documents,
* prompt injection,
* XSS,
* SSRF,
* secret exposure,
* logs,
* generated URLs,
* environment variables.

Fix high-severity issues before deployment.

---

# 31. PWA

The PWA is already working.

Preserve:

* installability,
* offline behavior,
* cached opened pages.

After changes rerun:

* browser tests,
* accessibility tests,
* PWA checks.

Do not break the existing PWA while modifying the backend.

---

# 32. TESTING

The repository currently has:

* 59 unit tests,
* 5 browser tests,
* accessibility coverage,
* production-build testing.

Preserve all tests.

After every significant change run:

* unit tests,
* typecheck,
* lint,
* production build,
* browser tests where relevant.

Before deployment:

run the complete suite.

Do not hide or skip failing tests.

---

# 33. EVALUATION

The existing evaluation successfully:

* linked all 130 mapped projects,
* recovered all 1,317 reference facts.

Preserve this evaluation.

Do not invent accuracy numbers.

If evaluation changes:

record:

* cases,
* expected result,
* actual result,
* failures,
* failure reasons.

---

# 34. PRODUCTION SMOKE TEST

After AWS deployment, test:

## Test 1

Open the public application.

## Test 2

Create a report/case.

## Test 3

Submit evidence.

## Test 4

Identify/search the project.

## Test 5

Retrieve official/source records.

## Test 6

Verify facts.

## Test 7

Run model analysis.

## Test 8

Verify final case.

## Test 9

Check CloudWatch metrics.

## Test 10

Test Gemini failure → Bedrock fallback.

## Test 11

Test an evidence-gap/UNKNOWN case.

## Test 12

Test the application from a clean signed-out browser.

Do not call deployment complete until these are verified.

---

# 35. DEMO CASE A

Maintain a reliable golden case showing:

1. report submitted,
2. project identified,
3. official records found,
4. facts verified,
5. contractor/project information established,
6. completion evidence established,
7. field evidence analyzed,
8. scope relationship assessed,
9. final determination,
10. evidence trail.

This should be stable enough for the demo video.

---

# 36. DEMO CASE B

Maintain a second golden case showing:

1. report submitted,
2. project identified,
3. some facts verified,
4. required evidence missing,
5. system refuses to guess,
6. DLP becomes UNKNOWN where appropriate,
7. case explains why,
8. next action is suggested.

This is essential to demonstrate responsible AI.

---

# 37. DEMO VIDEO

Optimize the application for a maximum approximately 3-minute demonstration.

Suggested flow:

### 0–15 seconds

Real problem.

### 15–35 seconds

Submit field report.

### 35–55 seconds

Identify project/road.

### 55–80 seconds

Show official records and verified facts.

### 80–105 seconds

Show completion/contract/DLP reasoning.

### 105–130 seconds

Show field evidence.

### 130–150 seconds

Show evidence chain/provenance.

### 150–170 seconds

Show missing evidence → UNKNOWN.

### 170–180 seconds

Closing:

> "CivicProof doesn't guess when evidence is missing. It shows what the evidence supports — and exactly what still needs verification."

The demo should show the product doing something difficult.

Do not spend most of the video showing architecture diagrams.

---

# 38. AWS ARCHITECTURE FOR THE DEMO

The final architecture should visibly demonstrate meaningful AWS usage.

Potential flow:

User
→ Web application
→ API
→ Lambda / workflow
→ S3 / DynamoDB
→ Textract
→ Bedrock Nova
→ Location
→ CloudWatch

Do not add services purely for appearance.

Every AWS service must have a clear reason.

---

# 39. COST

Optimize AWS cost.

Use:

* caching,
* content hashes,
* prompt/model versioning,
* image resizing,
* deterministic preprocessing,
* asynchronous processing where appropriate,
* retries with backoff.

Do not make unnecessary model calls.

Do not repeatedly process identical documents/images.

---

# 40. GIT HISTORY

Do NOT:

* rewrite history,
* fabricate dates,
* fabricate authors,
* squash history merely to make the project appear newer,
* remove commits to conceal when work happened.

Preserve the actual history.

If there is any question about hackathon eligibility or project start dates:

STOP and report it.

Never attempt to disguise history.

---

# 41. DOCUMENTATION

Ensure the repository contains:

`README.md`

`docs/architecture.md`

`docs/product-spec.md`

`docs/data-sources.md`

`docs/ai.md`

`docs/security.md`

`docs/limitations.md`

`docs/final-audit.md`

`docs/final-implementation-plan.md`

README should explain:

* problem,
* user,
* solution,
* evidence chain,
* architecture,
* AWS,
* AI,
* fallback,
* data,
* evaluation,
* security,
* limitations,
* deployment,
* demo.

Document AI coding tools used by the project.

---

# 42. MULTI-AGENT IMPLEMENTATION RULES

Parallel agents should be used aggressively for **independent work**.

Good parallel tasks:

* security audit,
* UX audit,
* testing audit,
* AI audit,
* AWS audit,
* documentation,
* independent code review.

Do NOT have multiple agents simultaneously modify:

* the same backend module,
* the same infrastructure file,
* the same database schema,
* the same critical state machine.

For shared implementation:

1. one agent implements,
2. tests run,
3. another agent reviews,
4. fixes are applied,
5. tests run again.

Prefer parallel analysis and sequential critical modifications.

---

# 43. CHANGE MANAGEMENT

Before every significant modification:

1. inspect the existing implementation,
2. understand dependencies,
3. state what will change,
4. modify the smallest necessary surface,
5. run tests,
6. inspect the diff,
7. fix regressions,
8. commit meaningful changes.

Do not rewrite working modules without justification.

Do not introduce dependencies without a clear reason.

Do not duplicate domain logic.

---

# 44. FINAL JUDGE REVIEW

Before submission, run parallel review agents:

## Impact reviewer

Evaluate:

* real problem,
* user clarity,
* impact,
* before/after transformation.

## AWS reviewer

Evaluate:

* genuine AWS usage,
* architecture,
* service selection,
* fallback,
* cost.

## Engineering reviewer

Evaluate:

* correctness,
* reliability,
* failure handling,
* determinism,
* maintainability.

## Evidence reviewer

Evaluate:

* provenance,
* hallucination risk,
* unsupported conclusions,
* UNKNOWN behavior,
* date correctness,
* source integrity.

## UX reviewer

Evaluate:

* clarity,
* polish,
* accessibility,
* mobile,
* case flow,
* evidence chain.

## Hackathon judge reviewer

Evaluate:

* memorability,
* technical depth,
* demo strength,
* execution,
* credibility.

Do NOT assign arbitrary numerical scores.

Return:

* strongest points,
* biggest risks,
* highest-impact remaining fixes.

---

# 45. DEFINITION OF DONE

The product is ready for submission only when:

* [ ] existing frontend still works
* [ ] existing core workflow still works
* [ ] unit tests pass
* [ ] browser tests pass
* [ ] accessibility tests pass
* [ ] production build passes
* [ ] PWA works
* [ ] SAM validates
* [ ] real AWS infrastructure is deployed
* [ ] Bedrock/Nova is accessible
* [ ] Secrets Manager works
* [ ] S3 works
* [ ] DynamoDB works
* [ ] Lambda works
* [ ] Textract works
* [ ] Location works
* [ ] CloudWatch works
* [ ] Gemini fallback works
* [ ] rate-limit handling works
* [ ] project identification works
* [ ] source provenance works
* [ ] fact verification works
* [ ] completion-date reasoning is correct
* [ ] DLP reasoning is deterministic
* [ ] field evidence reasoning works
* [ ] UNKNOWN behavior works
* [ ] human-review flow works
* [ ] privacy scan passes
* [ ] security review passes
* [ ] OMMAS/data-source issue is resolved or safely contained
* [ ] public production URL works
* [ ] clean-browser smoke test passes
* [ ] Demo Case A works
* [ ] Demo Case B works
* [ ] README is complete
* [ ] architecture is documented
* [ ] AWS usage is documented
* [ ] AI usage is documented
* [ ] data sources are documented
* [ ] limitations are documented
* [ ] Git history remains honest

---

# 46. NON-NEGOTIABLE PRODUCT RULES

Never:

* fabricate government records,
* fabricate project facts,
* fabricate contractor information,
* fabricate contract clauses,
* fabricate completion dates,
* fabricate citations,
* fabricate evaluation results,
* invent source URLs,
* claim unsupported accuracy,
* claim contractor responsibility without evidence,
* treat GPS as absolute identity proof,
* use an LLM for deterministic date calculations,
* expose secrets,
* expose unnecessary personal information,
* bypass CAPTCHAs,
* bypass source access controls,
* automatically submit complaints,
* add blockchain,
* add unnecessary multi-agent complexity,
* add unnecessary AWS services,
* rebuild the working frontend without justification,
* rewrite Git history.

---

# 47. NORTH STAR

When choosing between:

### A flashy feature

and

### stronger evidence

choose stronger evidence.

When choosing between:

### an AI-generated answer

and

### a verifiable answer

choose the verifiable answer.

When choosing between:

### guessing

and

### UNKNOWN

choose UNKNOWN.

When choosing between:

### five incomplete features

and

### one complete workflow

choose the complete workflow.

When choosing between:

### architecture that looks impressive

and

### architecture that is reliable and meaningful

choose reliable and meaningful architecture.

The goal is not to make CivicProof look intelligent.

The goal is to make CivicProof:

**trustworthy, explainable, technically impressive, genuinely useful, AWS-powered, and phenomenal to demonstrate.**

---

# 48. START NOW

Your first task is:

**AUDIT ONLY. DO NOT MAKE MAJOR CODE CHANGES YET.**

Use multiple independent agents/subagents in parallel to inspect:

1. architecture,
2. frontend/UX,
3. AI/evidence integrity,
4. AWS/security,
5. testing/reliability,
6. hackathon/demo readiness.

Then synthesize the findings into:

`docs/final-audit.md`

and:

`docs/final-implementation-plan.md`

After those documents exist:

1. implement P0 fixes,
2. run tests,
3. implement P1 improvements,
4. run tests,
5. deploy AWS,
6. run production smoke tests,
7. run security/privacy review,
8. run final judge review,
9. harden Demo Case A and Demo Case B.

Do not skip the audit.

Do not rewrite working functionality without evidence that it needs rewriting.

Do not declare success until the deployed product has actually been tested end-to-end.

**Build on what already works. Make it trustworthy. Make AWS real. Make the evidence chain exceptional. Ship it.**
