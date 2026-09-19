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
| P1 | **Git history purge.** 4,665 contractor phone numbers and 18 restricted OMMAS exports remain reachable from commits `feb0593`, `0b6f025`, `e4652ed`. Publishing with history intact exposes both. Recommended: scoped `git filter-repo` of those paths only, preserving every commit message, author, date and order. This contradicts the standing "never rewrite history" instruction, so it will not be run without explicit approval. | **BLOCKED** — `docs/PUBLIC_RELEASE.md` §5 |

---

## Data edits

| # | File | Change | Reason |
|---|---|---|---|
| *(pending)* | `corpus/projects.json` | Add a `value` to 3 reference facts (`bbmp-whitetopping-2023-24-pkg2·scope`, `bscl-tender-sure-phase-a-pkg7·roads_covered`, `·audit_finding`) | Defect D1's fix requires a `value` on every `official_record` claim. Measured blast radius: exactly 3 of 7,622. `npm run ingest` re-verifies the quotes verbatim, so the edit is self-checking. |
| *(pending)* | `corpus/documents/opencity-bbmp-work-orders-2025-26-198-wards.csv` + `corpus/manifest.json` | Redact the `contractor` column; update the file's `sha256` | 4,665 personal mobile numbers. **Zero evidence impact, verified:** 0 of 7,622 curated quotes contain a mobile-number pattern, and 0 citations reference this document. Hash and file must change together — `scripts/ingest.ts:100` fails the build otherwise. |
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
