# Decisions log

Every surface this work touches, kept or changed, with the reason. Appended as work lands; never rewritten.

**Rule:** "I would have written it differently" is not a reason. A `REPLACE` requires a written justification showing why `docs/CIVICPROOF_SPEC.md`'s version is clearly better.

**Precedence:** `docs/CIVICPROOF_SPEC.md` (items A–P) is authoritative for product requirements. `CLAUDE.md` is not; it governs repository mechanics only.

---

## Governing decisions

| # | Decision | Reason |
|---|---|---|
| G1 | Requirements come from the A–P checklist, written to `docs/CIVICPROOF_SPEC.md` | No design report exists in the repo. The audit must be able to cite requirements by item letter. |
| G2 | Correctness and deployment before new features | Ship It's entry condition is a deployed URL, and a spec-conformant app that states a wrong DLP as "verified" fails the spec's own first principle (item A). |
| G3 | **Public repository is a P0 submission blocker** | First Commit explicitly requires it. Overrides the "keep private" recommendation in `docs/final-audit.md`, which is withdrawn. See `docs/PUBLIC_RELEASE.md`. |
| G4 | Ambiguous Job Codes: the code establishes, corroboration disambiguates | Measured: 778/779 projects carry a code but only **529 are distinct** and **53 cover multiple projects** (`KN0204` → 13). A strict unique-match rule would make 53 codes permanently unverifiable, including the flagship Koira demo. Spec item D is still honoured: the identifier establishes, GPS only corroborates *within* the code's candidate set. |
| G5 | No code changes until the audit is complete | Requested explicitly. `docs/AUDIT.md` landed first. |
| G6 | **The OMMAS-derived evidence is shown in the hackathon demonstration**, with its attribution and citations intact | An explicit project decision, recorded in full under *"G6 — showing the OMMAS-derived evidence in the hackathon demonstration"* below. It settles what this project displays in one context. It does not alter the sources' own terms, and grants nothing. |

---

## KEEP AS-IS — equal to or better than the spec

Do not touch these. Each is a spec requirement already met or exceeded.

| # | Surface | Spec item | Reason |
|---|---|---|---|
| K1 | `maintenanceWindow`, `src/lib/agent/finalize.ts:54-81` | G, C.11 | Pure, UTC-pinned, `addMonths` clamps month-end; boundary behaviour verified correct by execution (completion day inclusive, end day inclusive, `before_completion` before, `outside:` after). Contractual Status will **wrap** it; the arithmetic is not re-derived. |
| K2 | Citation existence validation, `src/lib/agent/verifier.ts:59-76` | H | Already checks document exists, page exists, quote verbatim; rejects *and downgrades* `origin` to `ai_inference` (`:161`), returning the reasons to the model. Stronger than the spec asks. |
| K3 | `ClaimRow` + `buildCiteIndex` + `sourceHref`, `src/components/evidence.tsx:123-178` | I, C.14 | The Evidence Ledger already exists with Claim/Evidence/Source/Status, per-excerpt `checkNote`, deep links to the exact page with a highlight query, and citation numbering shared with packets. **Do not rebuild the ledger** — the Evidence Graph sits on top of it. |
| K4 | Draft-only packets; no auto-submission | J | Four independent disclaimers, and verified: no outbound POST to any authority exists anywhere in the codebase. |
| K5 | `demo` flag + `DemoTag` + demo-only home page | O | Schema-level flag, visible pill with an explanatory tooltip, and the home page shows only demo reports. Better than the spec asks. |
| K6 | `NeutralLanguageGuard`, `src/lib/agent/guards.ts` | A | Accusation lexicon blocked at the tool boundary — policy, not prompt. Satisfies "CivicProof doesn't accuse". |
| K7 | Cedar two-layer authorization, `policies/*.cedar` | L, M | Default-deny with a `forbid` backstop; denials surface in the user-visible trace. Extend with new policies; never replace with imperative checks. |
| K8 | `scoreMatches` formula, `src/lib/agent/tools.ts:22-45` | D | A good candidate ranker with human-readable reasons. Only its **authority** changes (it may suggest, not establish) — the formula itself is untouched. |
| K9 | The user-upload cap at `partially_verified`, `verifier.ts:142-147` | L | Correct for an RTI reply of unknown authenticity. The board photo deliberately routes around it by being an *index key*, not evidence — so this needs no change. |
| K10 | `redactContacts`, `src/lib/records/render.ts:34-40` | L | The function is correct, including the glued-on `NAME9XXXXXXXXX` form. Only its call sites are missing (one caller today). |
| K11 | `Case.status` as a workflow lifecycle | B, F | A workflow state is not a determination. The four determinations are added *alongside*; conflating them would break the owner-action Cedar policy and the 59 passing tests. |
| K12 | `MissingItem.reason` + `requestableRecord`, `schemas.ts:237-243` | J | Already 2 of the spec's 4 gap parts. Add the third; do not restructure. |
| K13 | The rules planner as a `Model` subclass, `rules-planner.ts:144` | M | Makes "runs locally with no model" true rather than aspirational, and makes a credible deployment possible before Bedrock access lands. |
| K14 | `SourceDocumentSchema` provenance, `schemas.ts:129-141` | E | id, title, publisher, source URL, retrieval date, content hash and licence — all present, hash verified at ingest. |

---

## CONFLICTS / PRESENT-BETTER — the spec describes it differently; what exists is better

| # | Surface | Spec item | Decision | Justification |
|---|---|---|---|---|
| C1 | Lambda Function URL + in-process orchestration (`infra/template.yaml:174-176`, `investigate/route.ts:48-68`, `run.ts:171-455`) | M (Step Functions, API Gateway) | **KEEP AS-IS** | The live NDJSON investigation trace depends on `InvokeMode: RESPONSE_STREAM`. API Gateway buffers and caps at 30 s; Step Functions cannot stream to a browser. `docs/ARCHITECTURE.md` records Amplify being rejected for exactly this. Migrating would destroy the most demo-visible asset in the product to satisfy a service checklist. **The submission must not claim Step Functions is used.** |
| C2 | `Case.status` (8-value workflow) vs "Overall case state" | F | **ADD ALONGSIDE** | See K11. |
| C3 | 779 real projects / 26 real documents vs "~20–30 projects" | O | **KEEP AS-IS** | The spec sets a floor, not a ceiling, and these are real verified records rather than fixtures. |

---

## Pending — awaiting a decision from the user

| # | Question | Status |
|---|---|---|
| P1 | **Git history purge.** 4,728 contractor phone numbers and 18 restricted OMMAS exports remain reachable from commits `feb0593`, `0b6f025`, `e4652ed`. Publishing with history intact exposes both. Recommended: scoped `git filter-repo` of those paths only, preserving every commit message, author, date and order. This contradicts the standing "never rewrite history" instruction, so it will not be run without explicit approval. | **BLOCKED** — `docs/PUBLIC_RELEASE.md` §5 |

---

## Data edits

| # | File | Change | Reason |
|---|---|---|---|
| *(pending)* | `corpus/projects.json` | Add a `value` to 3 reference facts (`bbmp-whitetopping-2023-24-pkg2·scope`, `bscl-tender-sure-phase-a-pkg7·roads_covered`, `·audit_finding`) | Defect D1's fix requires a `value` on every `official_record` claim. Measured blast radius: exactly 3 of 7,622. `npm run ingest` re-verifies the quotes verbatim, so the edit is self-checking. |
| *(pending)* | `corpus/documents/opencity-bbmp-work-orders-2025-26-198-wards.csv` + `corpus/manifest.json` | Redact the `contractor` column; update the file's `sha256` | 4,728 personal mobile numbers. **Zero evidence impact, verified:** 0 of 7,622 curated quotes contain a mobile-number pattern, and 0 citations reference this document. Hash and file must change together — `scripts/ingest.ts:100` fails the build otherwise. |
| *(pending)* | `corpus/documents/kppp-bbmp-whitetopping-pkg2-tender-full-view.json` + manifest | Redact 1 mobile number; update `sha256` | Same class of leak as the tender-officer number already fixed at the rendering layer. |


---

## Changes landed

### D1 — a value-less claim could be "verified" (spec items A, H)

| | |
|---|---|
| **Surface** | `src/lib/agent/verifier.ts:77` (`hasValue`), and the `checkNote` ternary |
| **Decision** | **EXTEND** |
| **Was** | `const hasValue = proposed.value ? valueSupported(...) : true;` — a claim with no `value` was treated as having its value confirmed, so model prose plus any genuine quote reached `verification: "verified"`, `origin: "official_record"`, a green **Verified** badge, and the complaint packet via `packet.ts:149` (`claim.value ?? claim.text`). |
| **Now** | `proposed.value?.trim() ? valueSupported(...) : false`. A value-less claim can reach at most `partially_verified`, with a `checkNote` that says why: *"the claim states no value to check against it."* |
| **Why the spec is better** | Item A ("AI interprets. Code verifies.") and item H ("the model may never invent … citations") are both defeated if an unverifiable sentence can carry the same badge as a grounded fact. |
| **Blast radius, measured** | Exactly **3 of 7,622** curated facts had no value; the ingest gate named all three immediately. Values were added and re-verified verbatim against their existing quotes — see *Data edits*. No other fact moved. |
| **Verified** | `npm run ingest` → 7,622 facts, 0 failures. `npx vitest run` → 59/59. |

### D3 — a financial completion date became *the* completion date (spec item 18)

| | |
|---|---|
| **Surface** | `src/lib/agent/text.ts` (new `labelledDates`), `src/lib/agent/finalize.ts` (new `labelKind`, new exported `physicalCompletionDate`; `maintenanceWindow`; `normaliseProposals`) |
| **Decision** | **REPLACE** the date-selection logic; **KEEP** the DLP arithmetic untouched (K1) |
| **Was** | `parseDates(completion.value!)[0]` — positional. The only guard was `/financial/i.test(...) && !/physical/i.test(...)`, which cannot fire on the real OMMAS cell because that cell names *both* kinds. Observed: window `inside:2029-05-27` marked `verification: verified, origin: computed`; the correct answer is `inside:2027-03-05`. **26 months of defect liability invented.** |
| **Now** | Dates are resolved by **label, not position**. `labelledDates` returns each date with the raw text on either side; `labelKind` classifies it by the *nearest* label on either side (a window-contains test was tried first and rejected — in the real cell it sees both "financial" and "physical" and classifies neither). `physicalCompletionDate` then: one stated date → usable unless that very date is labelled financial/payment/administrative; several → only an unambiguous physical label resolves it, otherwise **UNKNOWN**. `maintenanceWindow` requires it, so nothing derived from a financial date can exist at all, let alone be marked verified. `normaliseProposals` demotes an unresolvable `completion_date` to `other`, which makes the gap checklist ask for the real completion record. |
| **Why the spec is better** | Item 18 is explicit that a financial completion date is a different fact, and item A forbids guessing. Positional selection is a guess. |
| **Verified by execution** | 9 scenarios: curated cell → `inside:2027-03-05`; financial date → UNKNOWN + demoted; whole cell in the value → correctly picks physical; two dates unlabelled → UNKNOWN; single unlabelled date → still usable (no over-rejection); leading (`Physical: …`) and trailing (`… (Physical)`) label forms both handled. Regression tests added in `tests/verifier.test.ts` ("completion date: physical vs financial (defect D3)"), including the real cell string asserted to `inside:2027-03-05`. |
| **Verified** | `npm run ingest` → 0 failures. `npx vitest run` → 64/64. `tsc --noEmit` → clean. |

### D2 — conflict detection hid genuine disagreements (spec items 16, 17)

| | |
|---|---|
| **Surface** | `src/lib/agent/text.ts` (`typedQuantity`, `canonicalValue`, `sameFact` — replaced), `src/lib/agent/verifier.ts` (`detectConflicts` clustering, `rank`) |
| **Decision** | **REPLACE** the comparison and the clustering |
| **Was** | `canonicalValue` produced a degenerate bucket `"text:"` for any value with no token of length ≥ 2, so `9%` and `5%`, and `S` and `U`, were "the same fact". `sameFact` then had a second stage that overrode a correct first-stage disagreement whenever the digit multisets matched and either side lacked a whitelisted unit, so two different ISO dates, `12.5 million`/`12.5 crore` and `364.29 metres`/`364.29 km` all merged. `sameFact` was not transitive and clustering took the first matching cluster, so the outcome depended on input order: `["364.29 lakh","364.29 crore","364.29"]` gave 1 conflict in one order and 0 in another, silently keeping a wrong value. |
| **Now** | Values normalise into a **typed quantity** — `date \| money \| length \| duration \| ratio \| count \| text` — with explicit conversions (lakh/crore/million/thousand → rupees, m/km → metres, years/days → months). Two quantities are the same fact only when the **kind and the canonical magnitude are both equal**. Different kinds never merge. A figure with **no unit** is its own kind (`count`), so a dropped unit can no longer pass as equal to a unit-bearing value. Clustering is **union-find over the symmetric predicate**, i.e. the transitive closure, and the merge representative is chosen by a total order (rank, then value, then id) — so the result is a function of the values alone. |
| **Why the spec is better** | Item 16 requires genuine conflicts to be surfaced and formatting differences not to manufacture them; item 17 forbids silently dropping a unit. The old second stage did the opposite of both. |
| **Deliberate behaviour change** | `"364.29 Lakhs"` vs `"364.29"` previously **merged**; it is now a **conflict**. The existing expectation in `tests/verifier.test.ts` encoded the old intent and was moved from the merge table to the conflict table, on instruction ("*'364.29 lakh' and '364.29' are not equivalent. Fail closed when the unit cannot be established*"). A legitimate money merge (`Rs. 1,25,00,000` / `1.25 crore`) replaced it so that path stays covered. |
| **Reading recorded** | Exact canonical equality applies to *quantities*. **Names keep token-containment matching**, so `DPIU Of Bangalore u` and `DPIU Of Bangalore u (Bangalore Urban)` remain one fact — requiring exact equality there would re-create the original bug of manufacturing conflicts from formatting. |
| **Found by the property test** | Permutation invariance exposed a second, subtler order-dependence that union-find alone did not fix: `rank` tied between two equally-informative values, and `Array.sort` stability then let input order pick the representative. Fixed with a deterministic tiebreak. |
| **Verified** | New `tests/conflicts.test.ts` (22 tests): typed-quantity conversions; 6 must-merge pairs; 7 must-conflict pairs including every example named in the brief; and permutation-invariance over all orderings of 5 three-value groups. `npm run ingest` → 0 failures. `npm run eval` → **130/130, 1,317/1,317, 0 rejected, 0 denials — unchanged**, so the stricter rules cost nothing on the real corpus. |

### D4 — a unit could still be dropped to pass verification (spec item 17)

| | |
|---|---|
| **Surface** | `src/lib/agent/verifier.ts` (new `UNIT_REQUIRED`, a guard before `confidence`; `rank`) |
| **Decision** | **EXTEND** |
| **Was** | `valueSupported("364.29 lakh", row)` is `false` while `valueSupported("364.29", row)` is `true`, so the honest unit-bearing value scored worse than the stripped one. And `rank` capped unit information at 9 points against 10 per citation, so a bare figure with more citations became the merged claim that gets displayed and printed. |
| **Now** | A claim on a field whose value is meaningless without its unit (`sanctioned_cost`, `contract_value`, `estimated_cost`, `maintenance_cost`, `defect_liability`, `completion_period`) **cannot be `verified` when its value is a bare figure**: it is capped at `partially_verified`, the evidence is marked weak, and the model is told why. `rank` now puts a unit-bearing value above any citation count. D2 independently makes a bare figure and a unit-bearing one a *conflict* rather than a merge, so the dropped unit is surfaced rather than absorbed. |
| **Blast radius, measured** | **Zero.** All 777 `sanctioned_cost`, 564 `maintenance_cost`, 778 `defect_liability`, 2 `contract_value`, 1 `estimated_cost` and 2 `completion_period` curated values already carry their unit (`money` or `duration` kind); not one is a bare figure. |
| **Kept** | `splitUnitSupport` and `pageUnitNote` (`verifier.ts:179-207`) are untouched — they solve the real "table prints the figure, a note states the unit once" case and are the sanctioned route to verifying a unit-bearing value against a bare row. |
| **Verified** | `tests/integrity.test.ts` asserts a unit-less cost with a genuine quote is `partially_verified` with a "no unit" rejection. `npm run ingest` → 0 failures. |

### D5 — a model could author the defect-liability window (spec items 19, I)

| | |
|---|---|
| **Surface** | `src/lib/agent/finalize.ts` (`normaliseProposals`, `finalizeClaims`), `src/app/cases/[id]/key-facts.tsx`, `src/lib/packet.ts` |
| **Decision** | **EXTEND** |
| **Was** | `finalizeClaims` stripped a model-authored `maintenance_window` **only if** a computed one existed — so it survived in exactly the case where the answer should be UNKNOWN. `key-facts.tsx` then rendered it with `tone: "verified"` captioned *"Computed from cited dates"*, and `packet.ts` printed it as *"(computed from the cited dates)"*. A model's guess was presented as deterministic arithmetic. |
| **Now** | `normaliseProposals` drops **every** `maintenance_window` whose `origin !== "computed"`, unconditionally, so the only window that can exist is the one `maintenanceWindow` computes from verified dates. Both render sites and the packet additionally assert `origin === "computed"` before showing the "computed" wording. |
| **Why the spec is better** | Item 19: DLP status is deterministic code, never an LLM. Item I: provenance must be truthful — "computed from cited dates" is a provenance claim. |
| **Verified** | `tests/integrity.test.ts`: a model-authored window is dropped even when labelled `official_record` with a citation; and the complaint packet built from one contains neither "2031" nor "computed from the cited dates". |

### Summary after the five defects

`tsc --noEmit` clean · `npx vitest run` **92 passed** (was 59; 33 added) · `npm run ingest` **7,622 facts, 0 failures** · `npm run eval` **130/130 linked, 1,317/1,317 facts, 0 rejected, 0 denials — unchanged from before the fixes**.


---

## The four determinations (spec item F)

| | |
|---|---|
| **Surface** | new `src/lib/agent/determination.ts`; `src/lib/schemas.ts` (`DeterminationSchema`, `MissingItemSchema.whyItMatters`, `Investigation.determination`); `src/lib/agent/finalize.ts` (`finalizeClaims`, `missingChecklist`, new `WHY_IT_MATTERS`); `src/lib/agent/context.ts`; `src/lib/agent/run.ts` |
| **Decision** | **ADD NEW** |
| **Was** | Nothing. A grep for `HUMAN_REVIEW\|INSUFFICIENT_EVIDENCE\|POTENTIALLY_RELATED\|NOT_ESTABLISHED` across `src/` returned zero hits. The nearest thing was the computed `maintenance_window` *claim* and `Case.status`, an 8-value workflow lifecycle derived by one predicate (`run.ts:366`). |
| **Now** | `Investigation.determination` carries four independent determinations plus an overall state, all derived by plain code in a module with no I/O. |

**Placed on `Investigation`, not `Case`** — it is a derived output of one run, recomputed from that run's claims exactly like `conflicts`, `missing` and `nextActions`, and replaced wholesale when a run re-runs. `Case.status` stays as the workflow lifecycle (see K11); conflating them would have put two sources of truth behind the owner-action Cedar policy. The field is `.optional()`, so every existing stored case and all previously passing tests keep parsing.

**Contractual Status** *wraps* `maintenanceWindow` and re-derives nothing (K1). The end date is read out of the value the arithmetic already produced. One distinction is deliberate and is carried explicitly: `value` is ACTIVE/EXPIRED **as of today**, because that is what decides whether the obligation can still be relied on, while `observationInsideWindow` preserves whether the *observation* fell inside the period, because that is what a complaint argues. UNKNOWN names its own cause — no completion date, no defect-liability clause, both missing, conflicting dates, or an observation predating completion.

**Field Condition** reads `PhotoObservation.infrastructure_damage_visible`, which `run.ts:100` had been requesting from the model and **never reading**. A failed deterministic check is final: `fieldCondition` consults `sufficiency` *before* the model's flag, so a model opinion can never overrule a hard image check. No photo, or no vision model on the run, is `INSUFFICIENT_EVIDENCE` with a reason that says which — not a fifth invented state.

**Scope Relationship** may be `POTENTIALLY_RELATED` only when a verified scope claim's citation resolves **inside this project's own bundle**: the document id must be in `project.documents` *and* the page must exist in the corpus, both checked in code rather than taken from what the model said it cited. Its wording states the limit explicitly — the records place the work on this road; whether this particular defect arises from it is not established.

**Overall** is an ordered rule table over the three axes, total by construction, and asserted **exhaustively over all 108 combinations** (`3 identity × 3 contractual × 4 field × 3 scope`) against a restatement of the specification. Reading recorded, because the spec does not define the two positive values: **SUPPORTED** = the chain is complete and raises no contractual question (no defect, or the window has closed); **POTENTIAL_ISSUE** = complete *and* an open obligation, which is Golden Case A. `POTENTIAL_ISSUE` and `HUMAN_REVIEW` both set `requiresHumanReview`.

**"DLP active" never becomes "contractor at fault".** The `POTENTIAL_ISSUE` reason ends *"It does not establish who is responsible for the defect."* A test asserts that sentence is present and that no determination reason matches `caused|at fault|liable|negligen`. The wording was changed once during implementation: an earlier draft said "does not establish that anyone is at fault", which tripped the test's own word-boundary check — the reword removes the ambiguity rather than loosening the check.

**Evidence completeness** is `{have, of}` counted against the 7 `KEY_FIELDS` — `have` counts fields that actually have a usable claim, rather than subtracting the missing-item count, which would have been wrong whenever a gap was flagged for a non-key field. The schema comment states it is **not** a truth or probability score.

**"Why it matters"** is now on every gap, from a static per-field table in `finalize.ts` (`WHY_IT_MATTERS`) — deterministic and never model prose. Items the `flag_missing` tool produced inherit it by field, so the tool needed no change. With `reason` (why it is unknown) and `requestableRecord` (what would settle it) already present, gaps now carry four of the five parts; the fifth, the next action, already exists as a `NextAction`.

**Observed on the real seeded cases:** Thimmaiah (`bbmp-whitetopping-2023-24-pkg2`, a defect-liability clause on file but no verified completion date) reads `contractual UNKNOWN → overall UNKNOWN` — **Golden Case B, falling out of the data with no special-casing**. Kodathi reads `identity VERIFIED · contractual ACTIVE until 2027-03-05 · scope POTENTIALLY_RELATED`, and `field INSUFFICIENT_EVIDENCE` only because the seeded cases carry no photograph and the rules planner has no vision model. That is the honest reading, and it is what Golden Case A has to supply.

**Known interim state:** identity is currently `VERIFIED` whenever a project is linked, which is today's GPS-first behaviour. `RunContext.identity` is the slot the identity gate fills next, so that work changes one assignment rather than this module.

**Verified** — `tsc --noEmit` clean · `npx vitest run` **106 passed** (17 files; `tests/determination.test.ts` adds 14, including the 108-combination table) · `npm run ingest` 7,622 facts, 0 failures · `npm run build` exit 0 · `npm run eval` **130/130, 1,317/1,317, 0 rejected, 0 denials**.


---

## Identity: identifier-first, not identifier-required (spec items A, D)

| | |
|---|---|
| **Surface** | new `src/lib/agent/identity.ts`; `src/lib/corpus/index.ts` (`findProjectsByCode` + a derived code index); `src/lib/agent/finalize.ts`; `src/lib/agent/run.ts`; `src/lib/agent/rules-planner.ts`; `src/lib/agent/tools.ts`; `src/lib/packet.ts`; `src/lib/schemas.ts`; `src/app/report/report-form.tsx`; `src/app/api/cases/route.ts` |
| **Decision** | **REPLACE** what may establish identity; **KEEP** the candidate scoring itself (K8) |
| **Was** | Identity was proximity-first and unguarded: `scoreMatches` weighted GPS 0.7, `select_project` checked no score at all, and `rules-planner.ts` selected the nearest candidate unconditionally. A work identifier played **no** part — the name search deliberately excluded the project id, and 0 of 779 projects carried their code in a searchable field. Identity failure stopped nothing: the case still reached `evidence_found` and the packet still named the guessed project. |
| **Now** | A hierarchy, highest first: an identifier looked up exactly in the registry; a person's choice among what that identifier narrowed to; a `project_id` confirmed verbatim against a document in the selected project's **own** bundle; otherwise **UNVERIFIED**. |

**A Job Code is preferred, never required.** `jobCode` is optional on the report and on the case, so a citizen who only has a photograph, a pin and a description can still file. Without a code, candidates come from the location and road name exactly as before — candidate *discovery* is untouched. What changed is what may *establish* identity.

**Location may order candidates; it may never choose one.** `resolveIdentityFromCode` takes an `order` hook, and a test caught a real bug in the first version: the hook could *inject* a project, and with one registry match the code returned `candidates[0]` — the injected decoy — as VERIFIED. The hook is now constrained to a permutation: anything it adds is dropped and anything it omits is put back.

**An ambiguous identifier is settled by a person, not by searching harder.** 53 of 529 codes match several projects (`KN0204` matches 13, including the Koira demo road), so a strict unique-match rule would have made them permanently unverifiable. The result is `CODE_MATCHES_MULTIPLE_PROJECTS` — an unverified state — with the candidates listed nearest-first. They are shown but deliberately **not** added to `ctx.candidateIds`, so the existing Cedar policy (`select-only-located-candidates`) is what prevents anything from choosing on the reporter's behalf. The rules planner short-circuits before any location search, because `find_projects_near` assigns `ctx.matches` and would otherwise overwrite the candidates the identifier produced.

**The registry index is derived, not hand-maintained.** Built in `loadCorpus` from the curated `project_id` fact — which ingest has already verified verbatim against its source page — plus the slug as a fallback. 778 of 779 projects carry a code. A regex validated against **all 778** covers the six shapes the registry actually uses (`AA####` 545, `AA#####` 201, `AA####A` 15, `AA##-##` 6, `AA-##-##` 6, `AA#####A` 4) plus one BBMP work-indent form. Normalisation tidies case and separators but deliberately does **not** guess between look-alike characters: a wrong code must fail to match rather than match the wrong project.

**Without a code, a location match alone no longer establishes anything.** `resolveIdentityFromRecord` requires a `project_id` claim that is `verified`, whose value is the identifier the registry holds for that project, and whose citation resolves to a document in that project's own bundle with a page that exists. This is spec level 4 — "exact selection from a verified registry" — and it reuses `verifyClaim` untouched, so identity becomes a ledger row like any other fact.

**A real consequence, accepted rather than worked around:** `bscl-tender-sure-phase-a-pkg7` is the one project of 779 with **no `project_id` fact** — its records are a status PDF and a CAG report that never state a package number. Two demo cases on it therefore now read UNVERIFIED. That is the correct answer under the spec, and it gives the demo a third shape: *a plausible project was found by location, its identity could not be established, so the contractual reasoning stops.*

**What UNVERIFIED stops, and what it deliberately does not.** Stopped: the case reaching `evidence_found` (`run.ts`), the complaint naming the project or listing its facts, the computed window appearing in a packet, and the `defect_liability_repair_request` action, which names a contractor and an office. **Not** stopped: candidate discovery, reading project documents (that is how an identifier gets verified in the first place), the field evidence, the gap checklist, or the RTI draft — which is precisely the right next step when identity is unknown.

**The location score floor** is `MIN_LOCATION_SCORE = 0.55`, derived from the scoring already in use rather than invented: proximity contributes `0.7 * (1 - d/r)`, so at the default 750 m radius a candidate on the alignment scores about 0.70 and one 375 m away about 0.35. It is enforced in both remaining scoring paths — `select_project` returns an error the model can act on, and the rules planner flags the gap and finishes instead of linking the nearest guess. **Hard gate observed: the eval stayed 130/130 after the floor landed**, so nothing real regressed.

**Two-candidate ambiguity on the no-code path no longer selects either.** Previously the planner flagged the ambiguity and then linked the nearest anyway.

**Verified** — `tsc --noEmit` clean · **131 tests** (`tests/identity.test.ts` 16, five end-to-end cases in `tests/investigation.test.ts` covering an unambiguous code, `KN0204`'s 13 candidates, a malformed code, no code at all, and evidence preserved under UNVERIFIED) · ingest 7,622 / 0 failures · build exit 0 · **eval 130/130, 1,317/1,317 unchanged**.

### A latent bug the new tests exposed: the RTI clock ignored a same-millisecond reply

| | |
|---|---|
| **Surface** | `src/lib/rti-clock.ts` |
| **Decision** | **EXTEND** — a real defect, found because the new tests changed the timing |
| **Was** | The reply was selected with `e.at > submission.at`, comparing the timestamps the rows were *written*. When a submission and a reply are recorded in the same millisecond — which the warmed-up test run made routine — the reply was invisible, the clock stayed `waiting`, and a legitimate first appeal was refused. The test looked flaky; it was reporting a bug. |
| **Now** | Replies are selected and ordered by the dates the reporter recorded, which is what the file's own header says the clock counts from, with the write timestamp only as a tie-break and a not-before guard. |
| **Verified** | Three new cases in `tests/rti-clock.test.ts` (same-millisecond reply, a response dated before its application, earliest of several replies). `tests/investigation.test.ts` then passed **three consecutive full-file runs**, where it had been failing consistently. |


---

## Device location: the "use my current location" button (spec items A, L)

Audited end to end: the button, the fallbacks, what is stored, and what the reporter is told.

**What was already right and stays:** coordinates are rounded to six decimals (about 0.1 m, sensible for a pin); `maximumAge` is unset on the precise attempt so it defaults to 0 and never reuses a stale fix; the pin can always be corrected by tapping the map; and a `device` fix is labelled as such in `LocationSchema.source` rather than being passed off as a surveyed point.

**G1 — the accuracy the device reported was being thrown away.** `pos.coords.accuracy` was never read, so a 5 m satellite fix and a 2 km Wi-Fi fix were stored identically and both displayed as "from your device" at five decimal places — implying a precision the second one never had. This matters more here than in most products: the pin feeds `projectsNear` and the `MIN_LOCATION_SCORE` floor, and a 2 km fix at the default 750 m radius can sit on the wrong road entirely. The product's own rule is that a location corroborates; it cannot corroborate honestly with its uncertainty discarded. **Now** `accuracyM` is captured, carried through the report to `LocationSchema`, shown beside the pin ("±8 m"), repeated on the case page, and a fix coarser than `COARSE_FIX_M` (100 m) raises a warning inviting the reporter to drag the pin onto the damaged stretch.

**G2 — every failure claimed the reporter had declined permission.** The error callback ignored `err.code`, so a timeout, a device with location services off, and an actual refusal all produced *"Location permission was declined."* Someone who timed out indoors was sent looking for a permission prompt that was not the problem. **Now** the three `GeolocationPositionError` codes are distinguished and each says what to do; a test asserts that codes 2, 3 and unknown never mention "declined", and that every message still offers the map as a way forward.

**G3 — a ten-second timeout with `enableHighAccuracy: true` fails routinely indoors,** and with G2 it failed *misleadingly*. **Now** the precise attempt gets 20 s, and if it times out or the device reports no fix, a second attempt runs with `enableHighAccuracy: false` and a 60 s cache allowance — the network fix, which usually returns at once. A refusal is never retried, because retrying only re-prompts someone who has already said no.

**G4 — `navigator.geolocation` exists on an insecure origin but always fails there,** so the old guard missed it and the failure surfaced as G2's wrong message. **Now** `window.isSecureContext` is checked first and says plainly that location needs https.

**Testability.** The staged fallback was extracted from the component into `getDeviceLocation(geo)` in `src/lib/geo.ts`, which takes anything with `getCurrentPosition`. That turns the part worth testing into a pure function: `tests/device-location.test.ts` (12 tests) drives a scripted stand-in through a precise fix, a timeout falling back to the network fix, a device with no fix, a refusal that must *not* retry, both attempts failing, and accuracy values the device reports as 0/NaN/negative. Before this the button had **no test coverage at all**.

**Deliberately not changed:** project matching still uses the pin as-is. Feeding `accuracyM` into `projectsNear`'s radius or into the score floor is the principled next step, but it changes matching behaviour and the evaluation, so it is recorded here as a follow-up rather than slipped in under an audit. The data is now on the case, so that change is a small one when it is made.

**Verified** — `tsc --noEmit` clean · eslint clean on tracked source · **143 tests** (was 131) · build exit 0 · Playwright **5/5 with axe "no violations"**, including the report-flow map interaction.

---

## Post-audit remediation (19 September 2026)

Closing the findings from `docs/AUDIT.md` and the final pre-submission audit. Every item below was verified by running the thing, not by inspection alone.

| Finding | Action | Verification |
|---|---|---|
| **F3** determinations computed but not rendered | New `src/app/cases/[id]/determination-card.tsx`, mounted under `KeyFacts`. Shows the overall verdict first, then the three axes with their reasons, then identity (with the normalised code and, when a code is ambiguous, the candidate count), then completeness as *N of 7* explicitly labelled not a score, then the safety boundary. | Rendered page contains every element; **0** occurrences of causation/fault language; axe reports **no violations**. |
| **F4** `POTENTIAL_ISSUE` unreachable | A seed-only `demoObservation` option on `runInvestigation` (the HTTP route passes no such argument, so it is unreachable from the API) plus a generated **noise** fixture image — visibly not a photograph. The claim stays `ai_inference`/`unverified` and is labelled a demo fixture. | Kodathi now reads POTENTIAL_ISSUE · human review required · 7/7. Three regression tests, including one proving the observation is **refused** when the image gate fails. |
| **F6** completeness vs missing checklist disagreed | One shared `keyFieldSatisfied()` now backs both, so the sanctioned-cost-for-contract-value substitution applies identically. | Kodathi and Hebbagodi went from *6/7 with nothing missing* to **7/7 with nothing missing**; a test asserts satisfied + missing = 7 on both. |
| **F7** a malformed job code poisoned identity | A code that resolves pins identity; one that is malformed or matches nothing is recorded as an *attempt*, and the record-based resolver still runs. The rejected code is folded into the explanation. | A typo now yields VERIFIED-from-record with *"The work number supplied … could not be looked up. Identity was established from the verified project record instead."* Five tests cover valid, normalised, ambiguous, malformed-with-fallback and malformed-without. |
| **F8** `photoSufficiency` had no producer | Implemented as a **technical-usability** gate — present, decodes, clears a 640px short edge, not trivially small — computed in `run.ts` before any model sees the image. Its limits are stated in the README rather than overclaimed as image analysis. | A 64×64 fixture yields INSUFFICIENT_EVIDENCE even when a recorded observation says damage is visible. |
| **F11** evaluation could not fail | Prints scope (**130 of 779 projects, 1,317 of 7,622 facts**), states plainly that a rules run is a deterministic replay and not model accuracy, counts errored runs, and exits non-zero below thresholds (`EVAL_MIN_LINKED`, `EVAL_MIN_RECALL`). Added to `npm run check`. | `EVAL_MIN_RECALL=101 npm run eval` → exit 1. Normal run → exit 0. |
| **F12** prompt was location-first | Rewritten identifier-first: exact matching only, no fuzzy identifiers, location is supporting evidence, ambiguous codes wait for a person, and the model is told plainly that a deterministic verifier — not its confidence — decides what becomes a fact. | 155 tests and the evaluation unchanged. |
| **F13/F19** lint and clean-clone ordering | `.kilo/**` ignored in committed config rather than a developer's `.git/info/exclude`; `check.sh` now builds **before** typechecking (Next generates the types `tsc` needs) and no longer swallows lint warnings. | `npm run lint` exit 0; `npm run check` exit 0 end to end. |
| **F14** shared array from the code index | `findProjectsByCode` returns a copy. | Identity tests pass; no caller mutated it, so this closes a latent hazard. |
| **F15** ACTIVE contract under unverified identity | `determine()` reports contractual status as UNKNOWN unless identity is VERIFIED, explaining that the contract belongs to a project that is not established. | Regression test on the Lavelle Road shape. |
| **F16/F17/F18** | Whitespace removed; `@aws-sdk/client-lambda` and `@aws-sdk/s3-request-presigner` uninstalled (zero references); the never-produced `Verification: "unknown"` removed from the enum and its dead badge. | Build and 155 tests pass after removal. |
| **F20** packet safety | Five further tests: no causation/fault/liability wording, no unit-less figure printed as a fact, missing records named rather than filled, an RTI draft still produced when identity is unverified, and the draft disclaimer present. | 12 tests in `tests/integrity.test.ts`. |
| **F9/F10/F5** documentation | README gained *How a report becomes a determination* and *Where the system stops*, honest limitations, and the corrected test count; the Bedrock default was corrected to `apac.amazon.nova-pro-v1:0` in three documents; `docs/SUBMISSION.md` rewritten with real numbers and no placeholders. | Stale-claim sweep returns nothing. |

### F1 — public release: partly closed, one decision outstanding

**Done:** contractors' mobile numbers removed at source from `opencity-bbmp-work-orders-2025-26-198-wards.csv` (**4,728**) and `kppp-bbmp-whitetopping-pkg2-tender-full-view.json` (**1**), with the manifest SHA-256s updated in the same change and the redaction recorded in each document's `notes`. `npm run ingest` still verifies **7,622 facts, 0 failures** — no verified evidence was touched, and no reference fact cites the BBMP dataset at all. A `.gitattributes` entry exempts committed source data from whitespace rewriting so its hashes stay meaningful.

**History purge, dry-run proven, not applied — and its replacement list is now known to be incomplete:** `git filter-repo --replace-text` on a throwaway mirror took the history from **4,665 phone matches to 0** by that run's own pattern, replacing them with `[phone removed]`, while `git log --format='%an|%ae|%aI|%cI|%s'` was **byte-identical** before and after across all 26 commits. A full mirror backup was taken first. Not applied to the working repository and not pushed, per the standing instruction that no force-push happens without explicit confirmation.

**Correction (2026-09-19).** That pattern had a blind spot: it did not match a number preceded by `.`, so contractor cells of the form `KRISHNA.C.9740377357` were left intact — **43 occurrences, 17 distinct numbers**, which survived the working-tree redaction and were only caught by a later scan for *any* run of 10 or more digits. The working tree is now clean by that stricter test (`grep -oE '[0-9]{10,}'` → 0; no amount in this file exceeds 8 digits, so the wider pattern is safe here). The true working-tree total is **4,728** from the CSV, not 4,665. **The consequence for the pending purge: the proven `replacements.txt` would leave those same 43 occurrences in history.** Re-derive the replacement list from the stricter pattern and re-prove the dry run before any purge is applied.

**Outstanding:** the 18 OMMAS exports whose own licence restricts republication are still committed. A build-time downloader was investigated and **not** shipped: the committed files are SSRS report-viewer exports (`Textbox24,Textbox28` headers) whose re-export would not reproduce the committed SHA-256, so hash verification — the mechanism the whole provenance claim rests on — would break. Shipping an unproven downloader that gates `npm run ingest` would trade a licensing problem for a reproducibility one. This needs a decision, not a patch.

### F2 — deployment: blocked on external prerequisites

`infra/template.yaml` validates in structure and `scripts/deploy.sh` is deterministic, but neither the `aws` nor the `sam` CLI is installed here and there are no credentials, so nothing has been deployed. `docs/SUBMISSION.md` says so in those words rather than carrying a placeholder URL.

---

## G6 — showing the OMMAS-derived evidence in the hackathon demonstration

**Decided 2026-09-20. This is a project/release decision about what CivicProof displays in a named context. It is not a statement about what the underlying documents permit.**

**The decision.** The team has explicitly chosen that the licensing-restricted OMMAS-derived information CivicProof already uses **will be shown in the intended hackathon demonstration**. The affected evidence is not removed, is not replaced with invented or synthetic stand-ins, and is not quietly suppressed. Source attribution, document titles, page references, citations, provenance records and licensing notices stay exactly where they are.

**What the audit found, restated unchanged.** Eighteen of the twenty-six corpus documents are OMMAS/PMGSY exports carrying the publisher's own notice restricting republication (recorded per document in `corpus/manifest.json` as `© NRRDA (report footer). OMMAS's legal notice restricts r…`). Measured against the current corpus, **6,826 of 7,677 reference facts — 88% — cite at least one of those eighteen documents.** Those figures are unchanged by this decision; they are what makes it a decision worth recording rather than a detail.

**What this decision does not do.**

- It does **not** change, reinterpret, waive or extend the source's stated terms. Those terms are whatever NRRDA/OMMAS say they are, and this entry has no effect on them.
- It does **not** make the material open data, public-domain, freely reusable, or licensed for redistribution, and CivicProof must not describe it in any of those ways. The BBMP register is separately recorded as public domain; that is a fact about a different dataset and does not extend to the OMMAS exports.
- It does **not** grant anyone — user, viewer, judge or downstream reader — any permission the source does not already give them.
- It does **not** license the repository, the corpus, or any export for redistribution.

**What must remain true while this decision stands.** Every fact drawn from these documents keeps its visible source attribution, its document title and its page citation, on the case page and in every generated packet. A reader must always be able to see which document and which page a statement came from, and to open it. Removing or obscuring that attribution would turn a recorded-provenance decision into an unattributed republication, which is a materially different and worse position.

**Scope, and when to revisit.** This decision covers the **intended hackathon demonstration and its distribution context** — showing the running application, the demo cases and the recorded video to that audience. It does **not** extend to broader public redistribution: publishing the repository with the exports committed, mirroring the corpus, or distributing the documents as a dataset. **Before any of those, this decision must be reconsidered against the sources' actual terms**, alongside the two release items already open in F1 (the committed exports themselves, and the pending history purge whose replacement list is known to be incomplete).

**No behaviour changed because of this.** Determination logic, evidence verification, contractor verification, DLP arithmetic, complaint generation and fail-closed behaviour are untouched by this decision and must stay untouched by it. The only artefact of G6 is this entry. Verified after recording it: `npm run check` exit 0 — 221 unit tests, ingest 26 documents / 853 pages, evaluation 130/130 linked and 1,317/1,317 facts, 16/16 browser tests with no accessibility violations; all seven demo cases still produce the determinations they exist to demonstrate; and every citation on those cases still resolves to a real page whose quoted words are found on it.
