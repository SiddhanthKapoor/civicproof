# Public-release cleanup plan

**Status: P0 submission blocker.** First Commit requires a public repository. This repository **must not be published as-is**. The earlier recommendation in `docs/final-audit.md` to keep it private is withdrawn.

The governing constraint: *do not weaken the product's evidence claims in order to make the data public.* The evidence-chain architecture and the 7,622 verbatim-verified facts stay. Anything synthetic gets labelled.

---

## 1. Inventory — what cannot go public

Measured against the working tree at `1822608`. Counts are of matches, not of values; no values are reproduced here.

| # | Path | Problem | Backs facts? | Action |
|---|---|---|---|---|
| 1 | `corpus/documents/ommas-slr-pmgsy{1,2,3}-*.csv` (16 files) + `ommas-slr-pmgsy3-bangalore-urban.pdf` + `ommas-quality-grading-*` (2) — **18 documents** | Their own `licence` field in `corpus/manifest.json` records it: *"OMMAS's legal notice restricts republication without NRIDA's written permission."* | **Yes, load-bearing.** `ommas-slr-pmgsy1-tumakuru` alone carries 2,014 citations; the OMMAS set backs the overwhelming majority of the 7,622 facts | **Remove from the repo; replace with build-time retrieval** (§3) |
| 2 | `corpus/documents/opencity-bbmp-work-orders-2025-26-198-wards.csv` | **4,728 Indian mobile numbers** appended to contractor names in the `contractor` column — ~4,700 individuals' and small firms' personal numbers, published as a bulk greppable dataset | **No — 0 citations.** Verified: no reference fact cites this document at all; it is a searchable dataset only | **Redact in place** (§2). Licence is Public Domain, so redistribution is fine once the PII is gone |
| 3 | `corpus/documents/kppp-bbmp-whitetopping-pkg2-tender-full-view.json` | **1 mobile number** (a tender officer — the same class of leak fixed once already at the rendering layer) | Yes | **Redact in place** (§2) |
| 4 | Git history — commits `feb0593`, `0b6f025`, `e4652ed` | The blobs above remain retrievable from history even after they are removed from `HEAD` | — | **Decision required** (§5) |

**Confirmed clean, no action:** no secrets anywhere in history (`AKIA`/`ASIA`/`AIza`/`sk-`/`ghp_`/`xox`/`PRIVATE KEY`/`aws_secret_access_key` → 0 matches); `.env*` is gitignored with only `.env.example` committed, and it holds no values; `corpus/projects.json`, `authorities.json`, `extraction.json`, `manifest.json` contain 0 phone patterns; no personal email addresses in any committed document; `samconfig.toml` gitignored.

---

## 2. Redaction (items 2 and 3) — zero evidence impact

`redactContacts` already exists and is correct (`src/lib/records/render.ts:34-40`); it correctly handles the glued-on form (`NAME9XXXXXXXXX`), the spaced form, `+91` and STD landline variants. Today it runs only at render time (`scripts/ingest.ts:115`), so the *published pages* are clean while the *committed source* is not.

**Apply it to the committed artifacts**, not just the rendered output:

1. Run `redactContacts` over the `contractor` column of the BBMP CSV and over the kppp tender JSON, writing the redacted files back in place.
2. Update each file's `sha256` in `corpus/manifest.json`. **Both must change together** — `scripts/ingest.ts:100-102` verifies the manifest hash and fails the build on a mismatch, which is the gate that proves the edit was deliberate.
3. Re-run `npm run ingest`. It must still report **7,622 facts verified, 0 failures**.

**Why this cannot break the evidence chain** — two measurements, both verified:
- **0 of 7,622 curated quotes contain a mobile-number pattern.** Redaction cannot invalidate a quote.
- **0 citations reference the BBMP CSV.** Its 4,729 rows back no verified fact.

So the 7,622 facts are untouched by this step. Record the hash change and both measurements in `docs/DECISIONS.md`.

---

## 3. OMMAS (item 1) — build-time retrieval

The 18 OMMAS exports cannot be redistributed, and they back most of the corpus. Deleting them without a replacement would destroy the product's central claim, which the governing constraint forbids. So:

1. **Remove the 18 files** from `corpus/documents/` and add the pattern to `.gitignore`.
2. **Add `scripts/fetch-sources.mts`**, a documented build-time downloader that retrieves each report from the official OMMAS source. The live driver already exists and already does exactly this handshake — `src/lib/records/sources/ommas.ts` (layout token → report request → viewer → CSV export, with all 31 Karnataka district codes at `:22-53`). Reuse it; do not write a second client.
3. **Keep `corpus/manifest.json` in the repo** with every document's id, title, publisher, source URL, retrieval date and **`sha256`**. The manifest is the provenance record and is not itself restricted content. The downloader verifies each retrieved file against its committed hash, so a judge can prove the bytes are the same ones the facts were verified against — provenance is *preserved*, not weakened.
4. **Fail loudly.** If a source cannot be retrieved, `npm run ingest` must exit non-zero with the source named. Never substitute stale or synthetic data for a restricted real document (spec item O).
5. Cache under `corpus/.cache/` (gitignored), so repeat builds do not re-hit the portal.
6. **Respect the source:** the existing driver's throttling, its identifying User-Agent, and its 1-hour cache stay. Never bypass a CAPTCHA or any access control. If OMMAS blocks automated retrieval, stop and report rather than circumvent.

**Honest consequence, to be stated in the README:** a fresh public clone cannot build the full corpus offline; it needs one network fetch from the government portal. That is the price of not republishing restricted records, and it is the correct trade.

**Fallback if retrieval proves unreliable before the deadline:** ship a small, clearly-labelled synthetic fixture corpus (`demo: true`, visible `DemoTag`) sufficient to run the golden cases and the test suite, with the real manifest retained so the provenance chain is still legible. Synthetic records must **never** be presented as real government data (spec item O). Prefer retrieval; use this only if forced, and say so plainly in `docs/limitations.md`.

---

## 4. Verification before publishing

Run and record the output of each:

```bash
# PII and secrets across the whole tree and all history
git grep -nE '(^|[^0-9.])[6-9][0-9]{9}([^0-9.]|$)' -- . ':!*.lock'
git grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- corpus docs src scripts
git grep -nE 'AKIA|ASIA|AIza|sk-[A-Za-z0-9]{20,}|ghp_|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|aws_secret_access_key'
git log --all -p -- corpus/documents | grep -cE '(^|[^0-9.])[6-9][0-9]{9}'
git ls-files | grep -E 'ommas-|opencity-bbmp'        # must be empty for OMMAS after §3
npm run ingest                                        # must report 7,622 verified, 0 failures
```

Then the full suite: `npx vitest run` (59+), `npm run build`, Playwright against the production build (5/5, axe "no violations"), `npm run eval` (130/130, 1,317/1,317).

---

## 5. Git history — a decision I need from you

Removing the files from `HEAD` does **not** remove them from a public repository: all three blobs stay reachable from commits `feb0593`, `0b6f025` and `e4652ed`. So anyone could `git log -p` and recover 4,728 personal mobile numbers and 18 restricted government exports.

The options, plainly:

- **(a) Purge those paths from history** with `git filter-repo`, preserving every commit's message, author, date and order, then force-push. This *does* rewrite history and change commit hashes. It is scoped to data blobs only — it would not alter when work happened, who did it, or what the commits say. GitHub may retain unreferenced objects until garbage collection, so a support request to GC is part of it.
- **(b) Publish with history intact.** Simple and preserves hashes, but knowingly publishes ~4,728 people's phone numbers and the restricted exports. **I do not recommend this.**
- **(c) Publish a fresh repository** containing the cleaned tree and a documented pointer to the private original. Loses the visible incremental history, which is a genuine judging asset (25 honest commits over two days).

**My recommendation: (a).** The earlier instruction not to rewrite history was aimed at *concealing when work happened or who did it* — which (a) does not do. Removing personal data and restricted third-party content from history is a different act, and it is the only option that satisfies both the public-repo requirement and the privacy obligation. But this contradicts a standing instruction, so **I will not run it without your explicit go-ahead**, and the reason for the rewrite should be recorded in the README so the hash change is not mistaken for tampering.

---

## 6. Publish and verify

1. Complete §2, §3, §4 and the §5 decision.
2. Make the repository public.
3. From a **signed-out** browser: open the repo URL, confirm the README renders, confirm `corpus/documents/` contains no OMMAS export, spot-check the BBMP CSV for the redaction marker, and confirm the deployed application URL loads and a golden case walks end to end.
4. Re-run the §4 greps against the *public* clone, not the local tree.
5. Record completion, with the verification output, in `docs/DECISIONS.md`.
