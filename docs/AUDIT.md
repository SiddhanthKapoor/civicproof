# CivicProof — spec conformance audit

**Date:** 19 September 2026 · **Commit:** `1822608` · **Spec:** `docs/CIVICPROOF_SPEC.md` (items A–P)

**Method.** Six independent read-only audits (architecture, frontend/UX, AI/evidence integrity, AWS/security, testing/reliability, hackathon judge) plus three targeted explorations, plus a full local verification run and direct execution of the pure domain functions. Findings marked **[executed]** were reproduced by running the real code, not by reading it. No code was modified to produce this audit.

---

## 1. What this codebase is today

A **working, deployed-nowhere** Next.js 16.3.5 / React 19 / TypeScript application — an evidence-chain engine for Indian public works. A citizen files a geotagged photo report; an agent loop identifies the government project, retrieves official records, extracts facts, and a **deterministic verifier** accepts a fact only when the model's quote is found verbatim on the cited page of a real document. Packets (complaint / RTI / first appeal) are assembled from verified claims only and are never sent anywhere.

- **Domain layer** is Zod-modelled (`src/lib/schemas.ts`), one `Case` aggregate persisted as a single JSON document.
- **Agent layer** (`src/lib/agent/`) uses the Strands SDK with 13 tools, **Cedar policy-as-code** gating every tool call, and three interchangeable engines: Gemini, Amazon Bedrock (Nova), and a deterministic **rules planner** implemented as a real `Model` subclass — so the product runs end to end with no language model at all.
- **Data**: 779 projects, **7,622 reference facts each re-verified verbatim against its source on every build**, 26 documents, 128 roads with official geometry, 4,729 BBMP work orders.
- **Storage** is adapter-based: local JSON/files by default, DynamoDB/S3 on AWS, selected purely by environment.
- **Infra** is AWS SAM: one Lambda behind a Function URL in `RESPONSE_STREAM` mode, DynamoDB, S3, Secrets Manager, Textract, Bedrock, Amazon Location, CloudWatch.

**Maturity: high engineering quality, low spec coverage in three specific areas.** Verified by execution: 59/59 unit tests, 5/5 Playwright including an axe WCAG 2.1 AA audit (against *both* the dev server and the production build), `npm run eval` 130/130 projects linked and 1,317/1,317 facts recovered, production build clean, PWA installable, CloudWatch EMF metrics correct. Git history honest (25 commits, one author, no rewrite); no secrets in history. The gaps are not sloppiness — they are unbuilt features, plus five defects in code that *was* built.

---

## 2. Gap-analysis matrix

Status ∈ `MISSING | PARTIAL | PRESENT-EQUAL | PRESENT-BETTER | CONFLICTS`. Decision ∈ `KEEP AS-IS | EXTEND | REPLACE | ADD NEW`.

### A. Core principles

| Requirement | Item | Status | Evidence | Decision |
|---|---|---|---|---|
| "AI interprets. Code verifies." | A | **PRESENT-BETTER** | `verifier.ts:52` calls no model; verification is a pure function of (quote, page text, value). `tools.ts:282` returns the verdict *to* the model, so `record_claim` cannot self-certify | **KEEP AS-IS** — the inversion of trust is stronger than the spec's wording |
| Never turn a gap into a guess | A | **PARTIAL** | Holds architecturally, but **five defects breach it in practice** — see §3. E.g. a financial completion date yields `inside:2029-05-27` marked `verified`/`computed` **[executed]** | **EXTEND** (fix the five) |
| No invented confidence percentages | A | **PARTIAL** | `ClaimSchema.confidence` (`schemas.ts:228`) exists as a fixed ladder (0.95/0.6/0.45/0.1) but is **never rendered** — a correct decision. Explicit states exist as `VERIFICATION` (`schemas.ts:58`) | **KEEP AS-IS**; consider removing the dead field |
| Observation ≠ cause ≠ responsibility | A | **PRESENT-BETTER** | `NeutralLanguageGuard` (`guards.ts:24-39`) blocks an accusation lexicon at the tool boundary — policy, not prompt. `PHOTO_PROMPT` forbids guessing cause or party. No outbound accusation path exists | **KEEP AS-IS** |
| GPS may suggest; an identifier establishes | A, D | **CONFLICTS** | Inverted today: `scoreMatches` (`tools.ts:42`) is `proximity*0.7 + category*0.15 + name*0.15`, `select_project` (`tools.ts:177-196`) enforces **no score floor**, and `rules-planner.ts:75-78` selects the nearest candidate unconditionally. Job Code plays **no** role | **REPLACE** the *authority* of the score (not the formula) — see §4 P0-5 |

### B. Case model

| Requirement | Item | Status | Evidence | Decision |
|---|---|---|---|---|
| Case as primary object; PDF derived | B | **PRESENT-EQUAL** | `CaseSchema` (`schemas.ts:420-445`); packets are derived and optional (`packet.ts`), PDF via `/packet/pdf` | **KEEP AS-IS** |
| Case carries determination + human-review status | B, F, K | **MISSING** | No `determination` field anywhere. Grep for `HUMAN_REVIEW\|INSUFFICIENT_EVIDENCE\|POTENTIALLY_RELATED\|NOT_ESTABLISHED` in `src/` → **zero hits** | **ADD NEW** — §4 P0-4 |
| Case carries Job Code / project identity | B, D | **PARTIAL** | Identity is only `investigation.selectedProjectId` (`schemas.ts:312`); `project_id` exists as a *claim field* (`schemas.ts:168`) but never feeds back into selection | **EXTEND** |

### C. Pipeline — 18 stages, separately testable

| Stage | Item | Status | Evidence | Decision |
|---|---|---|---|---|
| 1 Create case | C.1 | **PRESENT-EQUAL** | `createCase`, `cases.ts:89` | KEEP AS-IS |
| 2 Capture project board | C.2 | **MISSING** | No board concept; grep `board\|signage\|hoarding` → only "CloudWatch dashboard" | **ADD NEW** (trimmed — §4 P0-5) |
| 3 Capture defect image | C.3 | **PRESENT-EQUAL** | `report-form.tsx` — EXIF read, hash-before-resize, magic-byte sniff (`cases.ts:46`) | KEEP AS-IS |
| 4 Evidence Sufficiency Gate | C.4 | **MISSING** | No resolution floor, blur, exposure, legibility or defect-visibility check; no `INSUFFICIENT EVIDENCE` + recapture. `MAX_EDGE=2000` downscales only. **`PhotoObservation.infrastructure_damage_visible` (`run.ts:100`) is requested and never read** | **ADD NEW** — P1 |
| 5 OCR / Job Code extraction | C.5 | **PARTIAL** | Textract works, but only for *reporter-uploaded documents* (`ocr.ts` ← `cases.ts:432`, the sole caller). Case **photos never touch OCR** | **EXTEND** |
| 6 Project Identity Resolution | C.6 | **CONFLICTS** | See A/GPS row | **REPLACE** |
| 7 Verified Project | C.7 | **MISSING** | No `PROJECT UNVERIFIED` state; identity failure does **not** stop the pipeline — status still reaches `evidence_found` (`run.ts:366`) and packets still name the guessed project (`packet.ts:117`) | **ADD NEW** |
| 8 Evidence Bundle retrieval | C.8 | **PRESENT-EQUAL** | `Project.documents` (`corpus/types.ts:46`) groups docs per project; live records overlay via `records/overlay.ts:70` | KEEP AS-IS |
| 9 Contract fact extraction | C.9 | **PRESENT-BETTER** | Model extracts, verifier grounds verbatim, rejections returned to the model with a corrective hint (`tools.ts:304-313`) | KEEP AS-IS |
| 10 Completion Evidence | C.10 | **PARTIAL** | One loosely-typed `completion_date`; the financial/physical distinction is a regex that cannot fire on the real OMMAS cell **[executed]** | **EXTEND** — §3 D3 |
| 11 Deterministic DLP | C.11, G | **PRESENT-BETTER** | `maintenanceWindow` (`finalize.ts:54-81`) — pure, UTC-pinned, month-end clamped; boundary behaviour verified correct **[executed]** | **KEEP AS-IS** — wrap, never reimplement |
| 12 Field evidence analysis | C.12 | **PARTIAL** | `analyzePhoto` (`run.ts:107-131`) returns a description + severity, stored `unverified`/`ai_inference`. Only `photos[0]`; the damage boolean is discarded | **EXTEND** |
| 13 Scope Relationship | C.13 | **MISSING** | Exists only as a numeric `score` + a boolean `established` (`chain.tsx:41`) + a prose missing-item | **ADD NEW** |
| 14 Evidence Ledger | C.14, I | **PRESENT-BETTER** | `ClaimRow` (`evidence.tsx:123-178`): Claim/Evidence/Source/Status with deep links to `/sources/{docId}?page=N&q=…`, expandable per-excerpt `checkNote`, citation numbering shared with packets (`evidence.tsx:65` ↔ `packet.ts:48`) | **KEEP AS-IS — do not rebuild** |
| 15 Evidence Graph | C.15, I | **PARTIAL** | `chain.tsx` is **5 static, non-clickable** nodes, `line-clamp-2`; spec wants 9 clickable nodes each answering "Why?" | **EXTEND** — P1 |
| 16 Overall Determination | C.16, F | **MISSING** | `Case.status` is a workflow lifecycle, derived by a single predicate (`run.ts:366`) | **ADD NEW** |
| 17 Evidence Gap Resolution | C.17, J | **PARTIAL** | 2 of 4 parts present: `MissingItem.reason` (why unknown) + `requestableRecord` (what resolves it). **No "why it matters"**; next action not linked from the gap | **EXTEND** — P1 |
| 18 Human review / next action | C.18, K | **PARTIAL** | Owner can add notes, change status, upload evidence, edit packets. **Absent**: confirm-a-fact, request-more-evidence as a verb, human-authored unresolved flag, reviewer identity | **EXTEND** — P1 |

### D–P

| Requirement | Item | Status | Evidence | Decision |
|---|---|---|---|---|
| Identity hierarchy (code → manual → QR → registry → GPS) | D | **MISSING** | No package-code regex anywhere; `find_projects_by_name`'s haystack (`tools.ts:148`) **excludes** the project id; 0 of 779 projects carry "KN03" in `name`/`roadNames` | **ADD NEW** |
| Exact verified-registry lookup by identifier | D | **MISSING**, but **feasible** | **778 of 779** projects carry the code as a `project_id` reference fact **[executed]**, so a derived index is buildable at ingest. Caveat: only **529 distinct codes; 53 codes cover multiple projects** (`KN0204` → 13) **[executed]** | **ADD NEW** — code establishes, corroboration disambiguates |
| Expose raw text / normalized id / validation / match / ambiguity | D | **MISSING** | — | **ADD NEW** |
| Bundle doc metadata: id, url, retrieval date, hash | E | **PRESENT-EQUAL** | `SourceDocumentSchema` (`schemas.ts:129-141`) has all four + `licence`; hash verified at ingest | **KEEP AS-IS** |
| Contractual doc typing (Tender/Agreement/BOQ/Amendment) + doc-level verification status | E | **MISSING** | No type field on corpus documents; `CASE_DOCUMENT_KINDS` (`schemas.ts:390`) types only *reporter uploads* | **CUT** — deferred, `docs/limitations.md` |
| Four independent determinations | F | **MISSING** | Zero grep hits for the enum values | **ADD NEW** — §4 P0-4 |
| "DLP active" ≠ "contractor at fault" | F | **PRESENT-EQUAL** | No such conflation exists today (there is no determination at all); the guard and packet wording are careful | **KEEP AS-IS** + preserve in new UI copy |
| Deterministic DLP incl. month-end/leap/timezone | G | **PRESENT-BETTER** | `addMonths` clamps month-end; all ISO/UTC **[executed]** | **KEEP AS-IS** |
| Amendments / DLP extensions | G | **MISSING** | No amendment concept | **CUT** — documented |
| Schema-constrained output; reject malformed | H | **PARTIAL** | Zod on all 13 tools; but the one structured-output call **silently drops** malformed output (`run.ts:116-117`, `if (!obs) return;`) with no log or retry | **EXTEND** |
| Validate every cited doc + page exists | H | **PRESENT-BETTER** | `verifier.ts:59-76` checks document exists, page exists, quote verbatim; rejects *and downgrades origin* to `ai_inference` (`:161`). Tested (`tests/verifier.test.ts:95-113`) | **KEEP AS-IS** |
| Model may never invent pages/ids/citations/dates | H | **PARTIAL** | Enforced for source URL, publisher, page, retrieval date. **Breached** for a value-less claim (`verifier.ts:77`) and for `maintenance_window` (`finalize.ts:200`) **[executed]** | **EXTEND** — §3 D1, D4 |
| Versioned prompts in `prompts/` | H | **MISSING** | No `prompts/` dir; two bare constants in `prompt.ts` plus inline strings | **CUT** — deferred |
| Log model, prompt version, input refs, output, timestamp per call | H | **MISSING** | Of the five, only **timestamp** is fully present; there is no per-model-call log at all (Strands printing disabled; only tool hooks registered) | **CUT** — deferred |
| Provenance: document → page → source → method | I | **PARTIAL** | Full doc/page/source/`checkNote` chain (`verifier.ts:84-103`). Extraction method is only the coarse `Claim.origin`; no prompt version | **KEEP AS-IS** (method), CUT (prompt version) |
| N/M completeness, labelled not-a-score | I | **MISSING** | Bare counts only; "Open questions: 0" renders **green** (`key-facts.tsx:57`), reading as "proven" | **ADD NEW** — P1 |
| Gap: what we know / don't / why it matters / what resolves / next action | J | **PARTIAL** | 2 of 5 (see C.17) | **EXTEND** |
| Draft labelling; never auto-submitted | J | **PRESENT-BETTER** | Four separate disclaimers (`packet.ts:23,268,344`; `packet-editor.tsx:194`). **Verified: no outbound POST to any authority exists anywhere** | **KEEP AS-IS** |
| Human review verbs | K | **PARTIAL** | notes ✓, close ✓ (via status); confirm ✗, request-more-evidence ✗, mark-unresolved ✗ | **EXTEND** — P1 |
| Evidence ids, hashes, duplicate detection, GPS as corroboration | L | **PRESENT-EQUAL** | Content-hash keys (`cases.ts:80`), duplicate rejection by hash (`:415`), owner keys SHA-256 + constant-time compare | **KEEP AS-IS** |
| Private storage, least-privilege IAM, no hardcoded secrets, upload validation, no secrets in logs | L | **PARTIAL** | Bucket fully private; Secrets Manager scoped to one ARN; magic-byte sniffing; logs carry no prompts/keys/PII. **But**: SAM canned policies over-grant, no `ReservedConcurrentExecutions`, no `AlarmActions`, EXIF GPS public | **EXTEND** — §4 P0-2 |
| Minimal PII | L | **CONFLICTS** | **4,665 contractor mobile numbers committed** in the BBMP CSV; `redactContacts` runs only at render time (one caller). Also `photos[].exif.{lat,lng,make,model}` public via `toPublicCase` | **EXTEND** — P0, `docs/PUBLIC_RELEASE.md` |
| S3 / DynamoDB / Textract / Bedrock / Lambda / Location / CloudWatch / IAM | M | **PRESENT-EQUAL** | All wired and called — see §5 of the AWS audit | **KEEP AS-IS** |
| **Step Functions + API Gateway** | M | **CONFLICTS** | Orchestration is in-process (`run.ts:171-455`) behind a Function URL with `InvokeMode: RESPONSE_STREAM` (`template.yaml:174-176`) | **KEEP AS-IS** — justified below |
| IaC matching the repo | M | **PRESENT-EQUAL** | SAM, `sam validate --lint` in `deploy.sh:15` | **KEEP AS-IS** |
| Adapters so it runs locally | M | **PRESENT-BETTER** | 8 of 9 services have a local stand-in *and* a `config.*Endpoint` override. Gap: `S3Client` (`blob/index.ts:50`) has no override | **KEEP AS-IS** + note the S3 gap |
| Never claim a service that isn't wired | M | **PRESENT-EQUAL** | True today; **must stay true** — the submission must not claim Step Functions | **KEEP AS-IS** |
| ~20 cases × 9 dimensions, able to fail | N | **PARTIAL** | `scripts/eval.ts` sweeps 130 corpus projects scoring 4 quantities; **0 of 9 dimensions scored separately**; **cannot fail** (exits 0 at 0/130); not in `check.sh`; no `eval/` fixtures; `eval-results/` gitignored | **CUT to a subset** — deferred |
| Don't invent accuracy numbers | N | **PRESENT-EQUAL** | 130/1,317 are computed at runtime, hardcoded nowhere (grep verified). Denominators must be stated: 130 of 779 projects, 1,317 of 7,622 facts, mapped projects only | **KEEP AS-IS** + state denominators |
| Golden Case A → "potential contractual issue — human review required" | N | **MISSING** | No such outcome state; **no seeded case or test ever produces a conflict** (all `.data/cases/*.json` show `conflicts: 0`) | **ADD NEW** — needs F |
| Golden Case B → DLP UNKNOWN, explained | N | **PARTIAL** | Scenario exists (`bbmp-whitetopping-2023-24-pkg2`: DLP clause, no completion date) and `tests/investigation.test.ts:105-114` asserts it — but resolves by **absence**, not an explicit UNKNOWN | **EXTEND** |
| ~20–30 project registry | O | **PRESENT-BETTER** | 779 real projects, 26 real documents | **KEEP AS-IS** |
| Synthetic data labelled `demo: true` + visible badge | O | **PRESENT-BETTER** | Schema flag (`schemas.ts:431`), `DemoTag` pill (`ui.tsx:97`), home page shows **only** demo cases (`page.tsx:33`) | **KEEP AS-IS** |
| Non-goals not built | P | **PRESENT-EQUAL** | No ratings, no corruption detection, no auto-submission, no blockchain, no chatbot, no swarm. Verified | **KEEP AS-IS** |

### The one CONFLICTS row that is a deliberate refusal

**Step Functions + API Gateway (item M) — KEEP AS-IS.** The spec asks for them; the stack deliberately uses a Lambda Function URL in `RESPONSE_STREAM` mode so the browser sees each tool call, Cedar decision and verified claim as it happens (`investigate/route.ts:48-68` streams NDJSON). `docs/ARCHITECTURE.md` records Amplify being rejected for its 30 s SSR timeout and lack of streaming. API Gateway buffers and caps at 30 s; Step Functions cannot stream to a browser. Migrating would destroy the live investigation trace — the single most demo-visible asset in the product — to satisfy a service checklist. **Recorded, not silently skipped, and the submission must not claim Step Functions is used.**

---

## 3. The five confirmed defects [all executed]

Each produces a **wrong answer presented as `verified`** — a direct breach of item A.

| # | Defect | Evidence |
|---|---|---|
| **D1** | A claim with **no `value`** is verified by any real quote. `verifier.ts:77` defaults `hasValue = true`. Model prose reaches a green *Verified* badge and the complaint via `packet.ts:149` | `verification = verified, origin = official_record` for `text: "The work order names M/s Ghost Builders Pvt Ltd…"` + an unrelated genuine quote. **Blast radius of the fix: exactly 3 of 7,622 curated facts lack a value** (`bbmp-whitetopping-2023-24-pkg2·scope`, `bscl-tender-sure-phase-a-pkg7·roads_covered`, `·audit_finding`) |
| **D2** | `detectConflicts` **hides genuine conflicts** | `sameFact("2022-03-05","2022-05-03")=true`; `("12.5 million","12.5 crore")=true`; `("364.29 metres","364.29 km")=true`; `("9%","5%")=true` (both canonicalise to the degenerate bucket `"text:"`); `("S","U")=true`. Not transitive ⇒ order-dependent: `["364.29 lakh","364.29 crore","364.29"]` → 1 conflict, `["364.29 crore","364.29","364.29 lakh"]` → **0 conflicts, keeps the wrong value**. Intended merges *do* work: `("12 months","1 year")=true`, `("5 years","5 months")=false` |
| **D3** | A **financial** completion date becomes *the* completion date | The `/financial/ && !/physical/` heuristic (`finalize.ts:191`) cannot fire on the real OMMAS cell `"Financial: 27-05-2024 / Physical: 05-03-2022"`, and `finalize.ts:58` takes `parseDates(...)[0]` = the financial one. Window `inside:2029-05-27` marked `verification: verified, origin: computed`; correct answer `inside:2027-03-05`. **26 months of defect liability invented** |
| **D4** | A **model-authored `maintenance_window`** survives exactly when no window can be computed | `finalize.ts:200` strips it only *if* a computed one exists. An `ai_inference` claim survives `normaliseProposals`, and `key-facts.tsx:51-52` renders it `tone: "verified"` captioned "Computed from cited dates" |
| **D5** | **Units can still be dropped.** `valueSupported("364.29 lakh", row)=false` while `valueSupported("364.29", row)=true`; and `rank` (`verifier.ts:247`) caps unit information at 9 points against 10 per citation, so `["364.29 Lakhs"(1 ev), "364.29"(2 ev)]` keeps the unit-less value | `scripts/eval.ts:68-70` scores a stripped value as a full recovery, so the eval cannot catch it |

**Registry code shapes** (needed for the identity engine), measured across all 778 codes: `AA####` 545, `AA#####` 201, `AA####A` 15, `AA##-##` 6, `AA-##-##` 6, `AA#####A` 4, one long BBMP work-indent form.

---

## 4. Existing strengths to preserve

Things the spec does not ask for and would be a loss to break:

1. **`npm run ingest` re-verifies all 7,622 facts against their sources and fails the build** (`scripts/ingest.ts:100-152`, wired into `prebuild`). A judge can falsify the entire data claim with one command. The strongest trust device in the project.
2. **Cedar policy-as-code at two layers**, default-deny, with a `forbid` backstop (`case-actions.cedar:46-49`) and policy ids surfaced in the **user-visible trace**. "The agent cannot mark a case resolved — that's a policy, not a prompt" is inspectable on the page.
3. **The rules planner as a real `Model` subclass** (`rules-planner.ts:144`) — the product runs with no model at all, through the same tools, Cedar and verifier. It is also what makes a credible deployment possible before Bedrock access lands.
4. **Cross-provider mid-run handover** (`run.ts:150-165`): `continuationPrompt` reconstructs provider-neutral state instead of replaying a transcript, so Nova never sees Gemini's message format.
5. **Live-record provenance**: `fetchOrReuse` (`records/archive.ts:25`) archives URL + timestamp + SHA-256 *before* the record is usable.
6. **The claim → quote → page → highlight round trip** with an explicit "found / not found verbatim" banner (`sources/[docId]/page.tsx:53-57`).
7. **Adversarial model stand-ins** (`tests/bedrock-agent.test.ts:17-31`): a scripted model that hallucinates a tender, writes "corruption", and selects an un-searched project — asserting the verifier, the guard and Cedar each catch their own case, over the real Converse wire protocol.
8. **Statutory RTI logic in code**: Karnataka rule 14's 150-word limit, s.6(2) no-reasons, s.7(2) deemed refusal driving an auto-drafted s.19(1) appeal.

---

## 5. Prioritised plan

Full detail in the approved implementation plan. Ordering per the brief: correctness and deployment before new features.

**P0**
1. Fix the five defects (D1–D5).
2. Harden anonymous/public access (investigation-wipe, geocode rate limit, concurrency ceiling, alarm actions, EXIF projection, live-record redaction, OMMAS SSRF allowlist, cap the case document).
3. **Public-repo cleanup** — `docs/PUBLIC_RELEASE.md`. Submission blocker.
4. Get AWS deployment working (rules-planner fallback if Bedrock access is slow).
5. The determination model (item F) — prerequisite for Golden Case A.
6. Deterministic identity resolution + `PROJECT UNVERIFIED` gate + score floor (item D, trimmed).
7. Golden Cases A and B as tests *and* demo fixtures.

**P1** — 8. Evidence Graph (9 clickable nodes). 9. N-of-M completeness labelled not-a-score. 10. Evidence Gap Resolver ("why it matters" + next-action link). 11. Sufficiency gate. 12. Human-review verbs.

**Cut / deferred, to be stated plainly in the submission** — Step Functions/API Gateway migration (justified refusal); board-photo OCR and QR/barcode; the full 9-dimension eval harness; `prompts/` versioning and per-call AI logging; contractual document typing; DLP amendments.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Bedrock model access is an external latency | Request it **first**; deploy on `Planner=rules` and flip via a stack update |
| `ConverseStream` has never executed (`run.ts:56` sets `stream: false` only for the test endpoint) | Rules-first deploy turns a launch blocker into a follow-up |
| D2's fix may surface conflicts the eval currently reports as clean merges | Record before/after; a drop caused by correctly detecting a real conflict is a gain, but must be explained, never hidden |
| The identity score floor could regress 130/130 linking | Hard gate: measure the eval before committing to a threshold |
| D1's fix demotes 3 of 7,622 facts unless those rows get values | Measured and named above; the ingest gate catches it immediately |
| 400 KB DynamoDB item; new phases add fields | Cap `matches`/`trace.detail` and stop swallowing the write error — in P0, not later |
| OMMAS retrieval may be unreliable once exports leave the repo | Fail loudly; labelled synthetic fixture corpus as a last resort, never presented as real |
| Git history retains restricted data and PII | Decision required — `docs/PUBLIC_RELEASE.md` §5 |
