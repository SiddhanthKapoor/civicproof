# CivicProof — target specification

**Status:** authoritative for product requirements.
**Source:** the A–P requirements checklist supplied with the implementation brief (19 Sep 2026). No separate design report exists in this repository; this file *is* the specification, reproduced verbatim so that `docs/AUDIT.md` and `docs/DECISIONS.md` can cite it by item letter.

**Precedence:** where this document and `CLAUDE.md` disagree, **this document wins**. `CLAUDE.md` remains useful only for repository mechanics — commands, paths, privacy rules, credential handling. It is not authoritative for product requirements.

---

## A. Core principles
Must hold everywhere in the code, prompts, and UI copy.

- "Never turn an evidence gap into a guess." "AI interprets. Code verifies." "Unknown is better than invented." "CivicProof doesn't accuse. It establishes."
- GPS may suggest; a verified identifier establishes. No AI-guessed project identity.
- No invented confidence percentages. Use explicit evidence states: Verified, Observed, Not Found, Unknown, Uncertain, Human Review.
- Observation ≠ cause ≠ responsibility. Never assert that a contractor caused a defect or is at fault.

## B. Case model
- CivicProof Case as the primary product object (Case ID, project identity, Job Code, official records, contractor, scope, completion, DLP, field evidence, scope relationship, determination, missing evidence, next action, human review status). A PDF is optional and derived from the case.

## C. Pipeline (spec §23), each stage separately testable
1. Create case → 2. Capture project board → 3. Capture defect image → 4. Evidence Sufficiency Gate (resolution, blur, lighting, relevance, identifier legibility, defect visibility; returns INSUFFICIENT EVIDENCE with a specific recapture instruction) → 5. OCR / Job Code extraction → 6. Project Identity Resolution → 7. Verified Project → 8. Project Evidence Bundle retrieval → 9. Contract fact extraction → 10. Completion Evidence → 11. Deterministic DLP calculation → 12. Field evidence analysis → 13. Scope Relationship → 14. Evidence Ledger → 15. Evidence Graph → 16. Overall Determination → 17. Evidence Gap Resolution → 18. Human review / next action.

## D. Project Identity Engine
- Hierarchy: Job Code from board photo → manual Job Code correction → QR/barcode if available → exact selection from a verified registry → GPS-assisted candidate suggestions (corroboration only).
- OCR pipeline: image → Textract (or an adapter) → normalization → identifier pattern validation → exact verified-registry lookup. Expose raw text, normalized identifier, validation status, registry match, and ambiguity. If there is no exact verified match, the result is PROJECT UNVERIFIED and nothing downstream runs on a guessed project.

## E. Project Evidence Bundle
- Per project: Tender, Agreement, BOQ, Work Order, Completion Record, Amendments, Other Records. Each document has: document ID, project ID, type, source URL, retrieval date, content hash, verification status.

## F. Independent determinations
Never collapsed into one AI verdict.

- Contractual Status: ACTIVE | EXPIRED | UNKNOWN
- Field Condition: DEFECT_OBSERVED | NO_DEFECT_OBSERVED | INSUFFICIENT_EVIDENCE | HUMAN_REVIEW
- Scope Relationship: POTENTIALLY_RELATED | NOT_ESTABLISHED | UNKNOWN
- Overall case state derived only from these by deterministic code. "DLP active" must never be presented as "contractor at fault."

## G. Deterministic logic (plain code, no LLM)
- Completion date + DLP duration → DLP expiry → ACTIVE/EXPIRED. If completion is not verified, DLP status = UNKNOWN. Include edge cases: month-end dates, leap years, timezone, amendments/extensions.
- Identity validation, state transitions, evidence classification.

## H. AI usage
Bedrock, or the existing provider behind an adapter if it is already good.

- Tasks: contract fact extraction, document interpretation, field-image observation, evidence sufficiency reasoning, scope relationship reasoning.
- Schema-constrained JSON outputs; reject malformed output; the model may never invent source pages, document IDs, citations, or dates. Validate that every cited document and page actually exists in the bundle.
- Versioned prompts in `prompts/` (contract-extraction-v1, field-analysis-v1, evidence-sufficiency-v1, scope-analysis-v1). Log model, prompt version, input references, output, and timestamp for every AI call.

## I. Provenance, Evidence Ledger, Evidence Graph
- Every extracted fact carries provenance: document → page → source → extraction method (and prompt version where AI-derived).
- Evidence Ledger table: Claim | Evidence | Source | Status.
- Evidence Completeness shown as "N / M required evidence elements available," explicitly labelled as NOT a truth or probability score.
- Evidence Graph / Evidence Explorer: the signature UI, a clickable chain (Field Photo → Job Code → Project → Agreement → Completion → DLP → Field State → Scope Relationship → Determination). Every node answers "Why?" with its source.

## J. UNKNOWN as a first-class state + Evidence Gap Resolver
- For every gap: What we know / What we don't know / Why it matters / What would resolve it / Next action.
- Targeted information-request drafts, labelled "Draft information request — review before use." Never auto-submitted anywhere.

## K. Human review
- Potential issues route to human review: confirm, request more evidence, mark unresolved, add notes, close case. No autonomous legal accusations.

## L. Evidence integrity, security, privacy
- Evidence IDs, case IDs, timestamps, optional GPS (corroboration only), content hashes, duplicate detection. Private storage, least-privilege IAM, no hardcoded secrets, upload validation, no secrets in logs, minimal PII, avoid faces/identities.

## M. AWS architecture (real, not decorative)
- S3 (evidence/docs, private), DynamoDB (cases/projects/documents/facts/state), Textract (OCR), Bedrock (interpretation), Lambda (deterministic logic), Step Functions (orchestration with retries/branching/failure handling), Amazon Location Service (spatial corroboration only), API Gateway, CloudWatch, IAM.
- Provide IaC (CDK, SAM, or Terraform, matching what the repo already uses) so it can actually be deployed. Use adapter interfaces so the whole pipeline also runs locally for demos and tests. Never claim a service is used if it isn't wired in.

## N. Evaluation harness + golden cases
- ~20 representative cases in an `eval/` folder measuring: identifier extraction, identity matching, evidence sufficiency, contract fact extraction, completion extraction, DLP calculation, field observation, scope relationship, final case state. Record correct / incorrect / unknown / failure reason. Do NOT invent accuracy numbers; report only what the harness actually measures.
- Golden Case A (complete evidence → "Potential contractual issue — human review required").
- Golden Case B (verified project + DLP duration but NO completion evidence → DLP = UNKNOWN → Overall = UNKNOWN, with an explicit explanation). Both must be automated tests and also work as the demo.

## O. MVP data scope
- Bounded Bengaluru/BBMP registry of ~20–30 projects with documents. If real verified records are not available in the repo, create clearly labelled synthetic DEMO FIXTURES (e.g. a `"demo": true` flag and a visible UI badge). Never fabricate records and present them as real government data.

## P. Explicit non-goals (do NOT build)
- Nationwide coverage, contractor ratings, corruption detection, autonomous government complaints, blockchain, multi-agent swarms, predictive pothole detection, a generic chatbot.

---

## Submission constraint (added 19 Sep 2026, overrides earlier guidance)

**First Commit requires a public repository.** Public-repo compliance is a **P0 submission blocker**. The repository must not be published as-is; see `docs/PUBLIC_RELEASE.md`. An earlier recommendation in `docs/final-audit.md` to keep the repository private is withdrawn.
