# CivicProof — final audit

**Date:** 19 September 2026 · **Commit audited:** `1822608` (plus uncommitted `CLAUDE.md`)
**Method:** six independent read-only audits (architecture, frontend/UX, AI/evidence integrity, AWS/security, testing/reliability, hackathon judge), plus a full local verification run by the lead. Findings marked **[executed]** were reproduced by running the real code, not by reading it.

---

## 0. Verification run — what actually works today

Run on a clean checkout of `1822608`. `node_modules/` was empty, so dependencies were installed first.

| Check | Result |
|---|---|
| `npm ci` | ✅ clean install |
| `npm run ingest` | ✅ 26 documents, 853 pages; **7,622 reference facts re-verified, 0 failures** |
| `npx tsc --noEmit` | ✅ **0 errors** — but only *after* a build (see D-3) |
| `npx eslint` (tracked source: `src scripts tests`) | ✅ 0 problems |
| `npx eslint` (repo-wide, as `npm run lint` does) | ❌ exit 1 — 1 error, in the untracked `.kilo/` worktree only (see D-4) |
| `npx vitest run` | ✅ **59/59 pass** — but only after `npm run ingest` (see D-2) |
| `npm run build` | ✅ production build succeeds, 28 routes |
| Playwright vs **production build** | ✅ **5/5 pass**, a11y reports "no violations" |
| Playwright vs **dev server** | ✅ **5/5 pass**, a11y reports "no violations" |
| `npm run eval` | ✅ **130/130 linked · 1,317/1,317 facts recovered (100%) · 0 rejected · 0 denials** |
| PWA in production | ✅ manifest `application/manifest+json`, 192/512 + maskable icons, `standalone`, 2 shortcuts, `sw.js` 200, `/offline` 200 |
| CloudWatch EMF metrics | ✅ emitted correctly as inline `_aws` metadata on every run |
| `sam validate` | ⛔ **not run** — the `sam` CLI is not installed on this machine |
| Real AWS | ⛔ **nothing deployed** — no `aws` CLI, no credentials, no `samconfig.toml` |

**Every local claim in the hand-off holds.** The numbers reconcile exactly:

| Claim | Verified | How |
|---|---|---|
| 779 projects | ✅ 779 | `corpus/projects.json` length |
| 7,622 reference facts | ✅ 7,622 | sum of `project.reference[]`; ingest prints 7,648 lines − 26 document lines |
| 128 roads with official map lines | ✅ 128 | `geometrySource.kind === "official"` |
| 130 mapped projects | ✅ 128 official + 2 OpenStreetMap | |
| 4,729 BBMP work orders | ✅ 4,729 | CSV lines − header |
| 59 unit tests / 5 browser tests | ✅ 59 / 5 | executed |
| Live OMMAS "any Karnataka district" | ✅ | 31 district codes, `src/lib/records/sources/ommas.ts:22-53` |
| Geographic scope stated honestly | ✅ | "Bengaluru pilot" (`src/app/page.tsx:93`); no nationwide language anywhere |
| Git history honest | ✅ | 25 commits, one author, 18–19 Sep 2026, clone-only reflog, no rewrite |
| No secrets in git history | ✅ | `AKIA/ASIA/AIza/sk-/ghp_/xox/PRIVATE KEY/aws_secret_access_key` — 0 matches |

Two numbers **do not** reconcile: `README.md:144` says "51 unit/integration tests" (actual 59), and `docs/SUBMISSION.md:32` says "9 public documents … 85 curated facts" (actual 26 and 7,622). The hand-off's "16 OMMAS exports" is also low: **18** are committed (16 `ommas-slr-*` plus 2 `ommas-quality-grading-*`).

---

## 1. Existing strengths

1. **The verifier is genuinely deterministic and is the load-bearing wall.** `src/lib/agent/verifier.ts:52` calls no model. A claim's verification level is a pure function of (quote, page text, value), and `record_claim` cannot self-certify — `src/lib/agent/tools.ts:282` hands the verdict back to the model. This inversion is correct and must not be softened.
2. **Ingest re-verifies all 7,622 facts against the source documents and fails the build.** `scripts/ingest.ts:100-152`, wired into `prebuild`. A judge can falsify or confirm the entire data claim with one command. This is the strongest trust device in the project and the README undersells it.
3. **DLP arithmetic is computed, not prompted.** `maintenanceWindow` (`src/lib/agent/finalize.ts:54-81`) is UTC-pinned pure code; `finalize.ts:200` discards a model-authored window when a computed one exists. Boundary behaviour is correct **[executed]**: completion day inclusive, end day inclusive, `before_completion` before, `outside:` after.
4. **The rules planner is a real `Model` subclass**, not a separate code path (`src/lib/agent/rules-planner.ts:144`), so "works with no model at all" is true rather than aspirational, and it drives the same tools, Cedar and verifier.
5. **Cedar at two layers with different principals**, default-deny, with a `forbid` backstop (`policies/case-actions.cedar:46-49`) and policy ids surfaced in the user-visible trace. 11 tests against the real WASM engine.
6. **Cross-provider mid-run handover is a real architectural insight.** `continuationPrompt` (`src/lib/agent/run.ts:150`) reconstructs provider-neutral state instead of replaying a transcript, so Nova never sees Gemini's message format. `RunContext` survives the swap untouched.
7. **Live-record provenance is modelled properly.** `fetchOrReuse` (`src/lib/records/archive.ts:25`) archives URL + `retrievedAt` + SHA-256 *before* the record is usable.
8. **The claim → quote → page → highlight round trip** (`src/components/evidence.tsx:104-121` → `/sources/[docId]?page=N&q=…`) with an explicit "found / not found verbatim" banner. The best thing in the UI.
9. **Security fundamentals are right**: magic-byte content sniffing (not `Content-Type`), owner keys stored as SHA-256 and compared in constant time, EXIF stripped from the stored image, optimistic locking with a `version` condition, no public bucket, Secrets Manager scoped to one ARN, no XSS sink anywhere (`dangerouslySetInnerHTML`/`innerHTML`/`eval` — 0 matches), clean logging (no prompts, keys or PII).
10. **Honest self-documentation**: the README's "What is real here" table with a *Real / Illustrative* status column, and `/how-it-works` listing nine real limitations.

---

## 2. Existing weaknesses

The three defects the retest found are **not fully fixed**. All of the following were reproduced by executing the real functions **[executed]**:

| Defect | Status | Evidence |
|---|---|---|
| (a) same fact in two formats treated as a conflict | **PARTIAL — the fix now hides genuine conflicts** | `sameFact("12 months","1 year")=true` ✓ intended. But `sameFact("2022-03-05","2022-05-03")=true`, `sameFact("12.5 million","12.5 crore")=true`, `sameFact("364.29 metres","364.29 km")=true`, `sameFact("9%","5%")=true`, `sameFact("S","U")=true` |
| (b) financial completion date recorded as completion date | **DOES NOT HOLD for the real record shape** | The financial date yields `inside:2029-05-27` marked `verification: verified, origin: computed`; the correct physical date yields `inside:2027-03-05`. 26 months of DLP invented |
| (c) units dropped to pass the verifier | **PARTIAL — incentive removed only for `lakh\|crore\|km`** | `valueSupported("364.29 lakh", row)=false` but `valueSupported("364.29", row)=true` |

Plus one defect nobody had catalogued: **a claim with no `value` is auto-verified by any real quote** (`verifier.ts:77` defaults `hasValue = true`). Model prose reaches a green *Verified* badge and the complaint packet's "Details from official records" **[executed]**.

Beyond evidence integrity, weakness concentrates in **run-lifecycle durability** (progress persistence that silently doesn't fire, a stale-run fix that never persists, two finalising writes missing the `runId` guard the periodic flush already has) and in **pre-deployment hardening** (an unauthenticated investigation trigger that wipes findings, an unmetered paid-API proxy, no concurrency ceiling, no alarm actions).

---

## 3. Features to KEEP (do not touch)

- The deterministic verifier and its inversion of trust (`verifier.ts`, `tools.ts:282`).
- `npm run ingest` as a build-time corpus gate.
- Computed DLP (`maintenanceWindow`) and the computed RTI clock (`src/lib/rti-clock.ts`).
- The rules planner as a `Model` subclass.
- Both Cedar policy files and their two-layer enforcement, including the `forbid` backstop.
- `continuationPrompt` and the `RunContext`-survives-the-swap design.
- Live-record archiving with URL + timestamp + hash.
- The whole existing frontend and its visual vocabulary (`src/components/ui.tsx`, `evidence.tsx`). No redesign.
- `redactContacts` at ingest, owner-key gating, `toPublicCase` at every boundary, magic-byte sniffing, the media route's `isSafeKey` + `photos/` prefix (no bypass found).
- The PWA: `public/sw.js` deliberately never caches `/api/*`, `/documents/*` or `.pdf`.
- The 779-project / 7,622-fact corpus and the eval harness.

## 4. Features to IMPROVE

- **Conflict detection** — make `sameFact` an equivalence relation and stop step 2 overriding a correct step-1 disagreement.
- **The completion-date data model** — type the kind of completion instead of regex-sniffing the prose.
- **Unit enforcement** — reject a unit-less value on money/length/duration fields.
- **Run lifecycle** — persist `stage`, add an `interrupted` state, guard the final writes with `runId`, make `settleStaleRun` persist.
- **The case page's verdict** — hoist `investigation.summary` above the fold; it is currently buried under four counters inside the *process* card.
- **The UNKNOWN block** — add "why it matters" and a link to the RTI draft.
- **Observability** — give `AppErrorsAlarm` an `AlarmActions` target and add a budget alarm.
- **Docs** — reconcile the drift catalogued in §11.

## 5. Features to REWRITE

Only two, both small and local:

- `sameFact` / `canonicalValue` clustering (`src/lib/agent/text.ts:199-239`, `verifier.ts:236-277`) — union-find over a symmetric, transitive predicate; never emit the degenerate `text:` bucket.
- The `completion_date` representation (`src/lib/schemas.ts:166-191`) — add a `completionKind` discriminator or distinct fields.

Nothing else warrants a rewrite. The architecture is sound.

## 6. Features to REMOVE

- `@aws-sdk/client-lambda` and `@aws-sdk/s3-request-presigner` — both in `package.json`, zero references in `src/`, `scripts/`, `tests/` or `infra/`.
- The dead `InvestigationFailuresMetric` metric filter (`infra/template.yaml:240`), which double-publishes a dimensionless series the dashboard never reads.
- `Verification: "unknown"` (`src/lib/schemas.ts:63`) is declared but never produced — either produce it or drop it.
- Nothing user-facing should be removed.

## 7. Missing CivicProof capabilities

1. **No "why it matters" on a missing item.** `MissingItemSchema` (`src/lib/schemas.ts:237-243`) has no such field, so four of the five parts of the UNKNOWN contract are met and the consequence of the gap is never stated.
2. **No deterministic near-tie disclosure on the LLM path.** The rules planner flags an ambiguous location (`rules-planner.ts:79-88`); `missingChecklist` never does, so on the model path the disclosure depends on the model choosing to call `flag_missing`.
3. **No per-claim model attribution.** `ClaimSchema` has no `producedBy`, so after a Gemini→Nova handover you cannot say which model produced which fact.
4. **No way to attach to a run in progress** — only `POST .../investigate`, which *starts* one. A mid-run page load shows a spinner that never advances.
5. **No human-review flow** in the sense CLAUDE.md §23 describes (confirm / request more evidence / mark unresolved / close). The owner timeline and packet editor are adjacent but not that.

## 8. AWS gaps

- **Nothing is deployed.** No `samconfig.toml`, no `.aws-sam/`, no credentials, and neither the `sam` nor `aws` CLI is installed here. `docs/SUBMISSION.md:7` still reads `**Live URL:** _add after ./scripts/deploy.sh_`.
- **Every AWS integration has only ever met a local stand-in**, and each stand-in returns HTTP 200 only — no AWS error body, no throttle, no IAM denial is faked anywhere.
- **Bedrock is tested non-streaming; production streams.** `run.ts:56-58` sets `stream: false` only when `BEDROCK_ENDPOINT` is set (tests). Production calls `ConverseStream` with `application/vnd.amazon.eventstream` and fragmented `toolUse.input` JSON. **Nothing in this repo has ever parsed a Bedrock event stream** — including the Nova fallback path.
- **S3 has no stand-in and structurally cannot get one**: `S3BlobStore` (`src/lib/blob/index.ts:50`) is the only AWS client with no `endpoint` override. Photos, packet PDFs and Textract's input object are untested on the production path.
- **Bedrock model access cannot be granted by CloudFormation.** `apac.amazon.nova-pro-v1:0` is a cross-region inference profile needing console-enabled model access plus destination-region foundation-model ARNs.
- Textract's async path is entirely untested and the sync path is tested at a size the real API rejects; `MAX_DOC_BYTES` sits exactly on Textract's 5 MB sync boundary.
- DynamoDB: `list()` discards `LastEvaluatedKey` (silent truncation past 1 MB); the test asserts read-after-write on a GSI, which dynalite grants and real DynamoDB does not; the whole case is one `doc` attribute against a 400 KB item limit, and `run.ts:258`'s `.catch(() => undefined)` swallows the resulting `ValidationException`.
- `@react-pdf/renderer` has zero tests and is a classic first-deploy Lambda failure.
- Amazon Location is the weakest-looking service: two calls with a fully functional Nominatim alternative beside it.

## 9. Evidence-integrity risks

Ranked. **All [executed].**

| # | Risk | Location |
|---|---|---|
| **E1** | A claim with **no `value`** is verified by any real quote; model prose is badged *Verified* and printed in the complaint as an official-record detail | `verifier.ts:77`; `packet.ts:149` |
| **E2** | `detectConflicts` **hides genuine conflicts**. Two different ISO dates, `12.5 million` vs `12.5 crore`, `metres` vs `km`, `9%` vs `5%` all merge. Clustering is order-dependent because `sameFact` is not transitive: `["364.29 lakh","364.29 crore","364.29"]` → 1 conflict, but `["364.29 crore","364.29","364.29 lakh"]` → **0 conflicts, keeps "364.29"** | `text.ts:226-239`; `verifier.ts:236-277` |
| **E3** | A **financial completion date still becomes *the* completion date** and drives the DLP window, marked `verified`/`computed`. The `/financial/ && !/physical/` heuristic cannot fire on the real OMMAS combined cell, and `parseDates(...)[0]` picks the financial date first | `finalize.ts:187-194`, `:58` |
| **E4** | A **model-authored `maintenance_window` survives exactly when the answer should be UNKNOWN** (`finalize.ts:200` strips it only if a computed one exists), and `key-facts.tsx:51-52` renders it with `tone: "verified"` and the note "Computed from cited dates" | `finalize.ts:200`; `packet.ts:104,119,151` |
| **E5** | The persisted `excerpt` is the **model's string, not the document's bytes**; squash/fuzzy matching lets a non-verbatim "quotation" into the packet unmarked | `verifier.ts:93`; `packet.ts:55,181-187` |
| **E6** | **Units can still be dropped**, and the conflict merge can itself drop them (`rank` caps unit information at 9 points against 10 per citation). `scripts/eval.ts:68-70` cannot detect it | `text.ts:169-196`; `verifier.ts:247` |
| **E7** | **No prompt-injection framing.** Retrieved records and reporter-uploaded PDFs reach the model with no "this is data, not instructions" delimiter; `SYSTEM_PROMPT` has no such clause. Cedar and the verifier prevent a forged *verified fact*, but injection can steer `finish`'s summary/analysis, `flag_missing` reasons and `select_project` reasons — and via E1/E4 produce content the UI labels verified/computed | `tools.ts:257,445`; `prompt.ts` |
| **E8** | **Fallback attribution**: no per-claim model field; `engine` stays the primary; a Bedrock throttle during the continuation is traced as *"Google Gemini rate limit reached"* | `run.ts:134-143` |
| **E9** | **RTI clock IST/UTC split**: the card uses IST (`rti-clock-card.tsx:9`), the server gate uses UTC (`cases.ts:260,280`). For 5.5 h daily they disagree by one day on a statutory deadline | |
| **E10** | Docs overstate the guarantee: `/how-it-works` says "Nothing is chosen silently" and `findings.tsx:12` promises units — both contradicted by E2 and E6 | |

What genuinely holds: no LLM anywhere in the trust path; project identity cannot be invented (Cedar gates `select_project` to `candidate_ids`); source URL, publisher, page and retrieval date always come from the corpus; `user_upload` and `news` are capped at `partially_verified`; next-action recipients come from the authority directory only.

## 10. Security risks

Full inventory in the AWS/security audit. Must-fix before real AWS, severity as assessed:

| # | Severity | Risk |
|---|---|---|
| **S1** | **High** | **An unauthenticated stranger can destroy and permanently lock any case's investigation.** `investigate/route.ts:34` authorizes as `Public::"anonymous"` (deliberate, per `case-actions.cedar:14`), but `run.ts:185-216` replaces `investigation` with a **fresh empty object**, and the per-case cap counts `investigation_started` *timeline events* (`route.ts:31`). Five anonymous POSTs discard a case's verified findings and exhaust its allowance forever — the real reporter then gets 429 with no reset path. Case ids are enumerable from `GET /api/cases`. **Verified by reading both the route and the policy.** |
| **S2** | **High** | **Rate limiting is per-instance and there is no concurrency ceiling.** `src/lib/http/index.ts:38` is a module-level `Map`; the template sets no `ReservedConcurrentExecutions` and the Function URL is `AuthType: NONE` with no CloudFront/WAF. Limits become 12·N and 20·N. Worst case 2048 MB × 300 s × account concurrency. |
| **S3** | **High** | **`/api/geocode` is an unauthenticated, unmetered proxy onto a paid AWS API** — the only cost route with **no** `rateLimited` call at all (confirmed: the file imports only `handle, json, problem`). `IntendedUse: "Storage"` is the higher-priced tier; the 500-entry per-instance cache is defeated by varying the query. |
| **S4** | **High** | **Nothing will tell you any of this is happening.** `AppErrorsAlarm` has **no `AlarmActions`**; there is no SNS topic, no budget alarm, and no alarm on either `CivicProof` metric filter. |
| **S5** | **Medium** | **EXIF GPS and camera make/model are returned to every anonymous caller.** `toPublicCase` (`schemas.ts:456`) strips only `ownerKeyHash`, `reporterContact`, `reporterName`, `packets`; `photos[].exif.{lat,lng,make,model}` passes through. The *original capture* coordinates at ~0.1 m precision are not the published pin, and make+model is a cross-case device fingerprint. One unauthenticated GET. **Verified.** |
| **S6** | **Medium** | **4,707 contractor phone numbers are committed to git** in `corpus/documents/opencity-bbmp-work-orders-2025-26-198-wards.csv`. Redaction is a *render-time* transform (`redactContacts` has exactly **one** caller, `scripts/ingest.ts:115`), so the public pages are clean and the derived artifacts contain zero phone patterns — but the raw CSV in version control is not. "Contractor phone numbers removed" is true of the rendered output, not of the repository. **Verified.** |
| **S7** | **Medium** | **Live-fetched records bypass redaction entirely.** `ommas.ts:235` builds public record pages with no `redactContacts`. Latent today (the reachable SLR columns carry no contact fields) but KPPP — whose tender JSON holds 14 phone numbers — is a planned source. |
| **S8** | **Medium** | **SSRF via the OMMAS session.** `ommas.ts:88` fetches an absolute URL verbatim when `pathOrUrl.startsWith("http")`, with `redirect: "follow"`, and `ExportUrlBase` is scraped from the portal's own HTML (`:154-156`). Not attacker-triggerable without controlling the portal, and Lambda has no IMDS to steal — but the function can be made to reach any host, and this file is the template for the next source. |
| **S9** | **Medium** | SAM canned `DynamoDBCrudPolicy`/`S3CrudPolicy` over-grant (delete, scan, and `s3:PutLifecycleConfiguration` — which could set a 1-day expiry on the whole evidence bucket). The code only ever uses Get/Put/Update/Query and GetObject/PutObject. |
| **S10** | **Medium** | TOCTOU on the in-progress check lets two runs start on one case; the daily budget counter increments *before* authorization and is never refunded, so 150 unauthenticated requests deny investigations for everyone until UTC midnight. |
| **S11** | **Low** | The Gemini key is passed as a `sam deploy` command-line argument (`deploy.sh:24`), world-readable via `ps`. No CSP on HTML pages. `/api/health` discloses the planner and Bedrock model id. |

Clean and verified: no exposed secret anywhere (git history, `.env.example`, source, corpus, `public/`); nothing secret can reach the client bundle (`server-only` in all 13 server modules, zero `NEXT_PUBLIC_*`); no XSS sink; no path traversal in the media route; no public S3; logging carries no prompts, keys or PII.

## 11. UX risks

- **The case page has no verdict.** `investigation.summary` — the one sentence saying what the evidence establishes — is rendered *inside* the process card, below four counters (`investigation-panel.tsx:196`). A viewer scanning for "so what?" meets "Agent steps 19" first.
- **Two different "verified" counts on one screen**, computed with different predicates (`investigation-panel.tsx:133` vs `findings.tsx:36`).
- **"Open questions: 0" is rendered in green** (`key-facts.tsx:57`) and reads as "this case is proven", when it means "everything on our fixed checklist was answered". This is the completeness-is-not-a-score risk CLAUDE.md §26 warns about, live in the UI.
- **The UNKNOWN block has no next action** — no link to the RTI draft — and no "why it matters".
- **The six pipeline stages vanish after the run** (`investigation-panel.tsx:165`), so anyone arriving at a finished case never sees the pipeline.
- **Chain nodes clip mid-word** (`chain.tsx:92`), visible in the committed screenshots as `DPIU Of Bangalore u`.
- **Accessibility, beyond what axe sees**: `BorderTrail` and `TextShimmer` animate non-transform properties, so both keep looping under `prefers-reduced-motion` (WCAG 2.2.2); the *active stage* label is a shimmer whose sweep hits **1.71:1** — the same species of failure just fixed, and invisible to axe because of `color: transparent`; `aria-live` sits on the whole trace `<ol>` so a screen reader gets 20–150 appended items while the current stage is announced nowhere; the mobile menu has no focus management; the case `<aside>` (photo, map, report text) is outside the heading outline.
- **Mobile**: one 1440×900 viewport is tested, so WCAG 1.4.10 Reflow and 1.4.4 Resize Text are never exercised on a product used at the roadside; the 340 px mid-form map has `cooperativeGestures: false`, trapping one-finger scroll; the photo input has no `capture` attribute; the citizen's own photo is last in DOM order on mobile.

## 12. Testing risks

- **`npm test` fails on a fresh clone** (14/59) — `corpus/generated/pages.json` is gitignored and there is no `pretest` hook. **[executed]**
- **The a11y test crashes on an unseeded store** — `a11y.spec.ts:11` does `cases.cases[0].id` on an empty array, so it fails with a `TypeError` *before running axe at all*, for a reason unrelated to accessibility. `scripts/check.sh` never seeds. **[executed — this was the initial failure here]**
- **`check.sh` is weaker than it looks**: the `|| npx eslint` fallback swallows warnings so `--max-warnings=0` is not a gate; e2e is silently skipped with no server (exit 0); `npm run build` and `npm run eval` are not in the gate; and there is **no CI configuration in the repo at all**.
- **The eval cannot fail.** `eval.ts:109-112` exits 0 at `0/130` and `0/1317`; `inv.error` is recorded per row but never aggregated; `eval-results/` is gitignored so there is no baseline to diff. It also covers **130 of 779 projects and 1,317 of 7,622 facts** — by design, since a synthetic pin cannot exercise a road with no geometry — which excludes the 649 name-only rural roads that are the corpus's bulk. The claim is accurate as worded; the denominator should be stated.
- **The rate-limit *wait* path is never executed.** Both throttling tests send *daily*-quota bodies, which `rate-limit.ts:38` short-circuits before any wait. Backoff, the 65 s cap, `retryAfterMs` parsing and the `onWait` trace note have zero coverage — on the free tier this is the code that runs most often. No test uses fake timers anywhere.
- **No regression test** for: the literal `12 months`/`1 year` conflict case; any hidden-conflict case; a unit-less value being refused; the real OMMAS combined-date cell; prompt injection on any of the three untrusted ingress paths; `redactContacts` (zero tests, one caller); Cedar engine failure falling closed; PWA/offline; mobile viewport.
- **`redactContacts` has no test at all**, which for a stated privacy guarantee with a known unredacted code path (S7) is the shape of a quiet regression.

## 13. Demo risks

- **`docs/DEMO_SCRIPT.md` is two commits stale.** It never mentions finding a road by name without a map line, live OMMAS search, the Bedrock takeover, the 779-project corpus or the BBMP dataset — i.e. all of the best material. It spends its first 40 s on a form and its last 20 s on a static diagram.
- **Two screenshots actively damage the submission**: the README hero (`docs/screenshots/case.png`) shows the badge *"Rules planner · no language model"*, and `live.png`, captioned "Live investigation streaming", shows a trace containing only *"Starting…"*.
- **The flagship demo case has zero open questions**, so the UNKNOWN story — the pitch — is absent from the most-linked case.
- **The live run is over in ~1 s** with the rules planner, and the stage list then disappears.
- **"Run again" vanishes silently** after 5 runs (`case-dossier.tsx:217` hardcodes `< 5` while the server reads config), with no explanation.
- **The Koira Gemini run exists nowhere a judge can see it** — no transcript, no screenshot, no doc paragraph. A test pins the behaviour but runs the rules planner.
- One `npm run eval` consumes **130 of the 150** daily investigation budget shared with e2e.

## 14. Deployment blockers

1. `sam` CLI not installed. `aws` CLI not installed. No credentials.
2. Bedrock model access for `apac.amazon.nova-pro-v1:0` in `ap-south-1` is not provisioned (and cannot be by CloudFormation).
3. S1–S4 above should be fixed before a public, unauthenticated URL exists.
4. The Bedrock **event-stream** path has never executed; the first real Nova call is the first test of it.
5. `@react-pdf/renderer` in Lambda is untested.
6. `docs/SUBMISSION.md` has three unfilled placeholders, including the whole "What I learned" section — a named judging dimension.
7. **OMMAS licensing is unresolved** and is a release blocker for making the repo public (18 exports committed; NRIDA's notice restricts republication). S6's 4,707 phone numbers are a second, independent public-release blocker.

---

## 15. Documentation drift found

| Where | Says | Actually |
|---|---|---|
| `README.md:144` | 51 unit tests | 59 |
| `docs/SUBMISSION.md:32` | 9 documents, 85 facts | 26, 7,622 |
| `docs/DATA_SOURCES.md:51` | BBMP CSV "left out" because of phone numbers | It is in, 4,729 rows, and is a headline claim |
| `docs/DATA_SOURCES.md:7-17` | tables 9 documents | 26 |
| `docs/DATA_SOURCES.md:3` | all retrieved 18 Sep 2026 | manifest says the CSVs were retrieved on the 19th |
| `docs/DEPLOY.md:30-31`, `docs/AGENT.md:30`, `README.md:135` | Bedrock default `global.anthropic.claude-opus-5`; planner defaults to `bedrock` | `apac.amazon.nova-pro-v1:0`; planner defaults to `gemini` |
| `docs/SECURITY.md` | Bedrock IAM scoped to "Claude foundation models" | grants `amazon.nova-*` |
| `docs/ARCHITECTURE.md:33-38` | tool list | omits `find_projects_by_name`, `search_public_records`, `fetch_public_record` |
| `docs/DATA_SOURCES.md:56` | "Decide before publishing the repository publicly…" | an unresolved note-to-self in judge-facing documentation |

Also: CLAUDE.md §41 asks for lowercase `docs/architecture.md`, `docs/security.md`, `docs/data-sources.md`, `docs/ai.md`, `docs/product-spec.md`, `docs/limitations.md`. The repo has `ARCHITECTURE.md`, `SECURITY.md`, `DATA_SOURCES.md` in caps and no `ai.md`, `product-spec.md` or `limitations.md`. This resolves on macOS and breaks on Linux CI.
