# The investigation agent

## Design goals

1. A language model does the reading. It never has the last word on a fact.
2. Every action the model can take is a narrow, typed tool, and every tool call is authorized by policy.
3. The product works, and is testable, without any model at all.

## Tools (`src/lib/agent/tools.ts`)

| Tool | Kind | Notes |
|---|---|---|
| `get_case_report` | read | Title, description, category, location and how it was obtained, photo EXIF summary, AI photo description if any, and any documents the reporter added (searchable and readable with the tools below). |
| `find_projects_near(radius_m)` | read | Distance from the pin to each project alignment (point-to-polyline), plus type-of-work and road-name matches. Cedar caps the radius at 2 km. |
| `find_projects_by_name(query)` | read | Projects whose name, place names or block match the query, for roads with no published alignment. Gives the distance from the pin where a project has geometry, so a same-named road elsewhere is not mistaken for this one. |
| `search_public_records(query)` | read, live | Searches the report district's OMMAS road lists (PMGSY-I to III) on the government portal. Returns leads only. Cedar: at most 6 per run. |
| `fetch_public_record(record_id)` | read, live | Fetches one road's OMMAS row, archives it (S3 on AWS) with URL, time and SHA-256, and adds it to the run's corpus so it can be read, quoted and linked by name. Cedar: only ids a search returned, at most 6 per run. |
| `select_project(project_id, reasons)` | proposal | Cedar only permits ids the location search returned (`context.session.candidate_ids`). |
| `list_project_documents` · `search_documents` · `read_document_page` | read | MiniSearch full-text over all pages; pages are returned verbatim (clipped at 7,000 chars). |
| `record_claim(field, text, value, origin, citations[])` | proposal | Runs the verifier; returns the verdict and rejection reasons so the model can correct a quote once. |
| `flag_missing(field, reason, requestable_record)` | proposal | Feeds the RTI application. |
| `propose_next_action` | proposal | Merged with rule-derived actions and labelled "AI suggestion". |
| `finish(summary, analysis)` | proposal | Neutral-language guarded. |

There is no tool that writes outside the case, changes status, sends anything or makes network requests.

## Models

- **Google Gemini** (`GoogleModel` from `@strands-agents/sdk/models/google`), the default when `GEMINI_API_KEY` is set; model from `GEMINI_MODEL_ID` (default `gemini-3-flash-preview`). Rate limits and "high demand" 503s are waited out by `src/lib/agent/rate-limit.ts`, which honours the server's retry hint and fails fast on a daily quota.
- **A model on Amazon Bedrock** (`BedrockModel`, Converse API). Default `global.anthropic.claude-opus-5`; any Bedrock model with tool use works via `BEDROCK_MODEL_ID`. Photo description uses a separate structured-output call with an image block.
- **Rules planner** (`src/lib/agent/rules-planner.ts`): a Strands `Model` subclass that emits the same tool calls a careful investigator would, using the human-curated extractions in `corpus/projects.json`. It flags near-tie locations. Its runs are labelled "Rules planner · no language model".

## The verifier (`src/lib/agent/verifier.ts`, `text.ts`)

For each citation: the document and page must exist; the quotation (≥6 chars, normalised for whitespace, typography and the rupee sign) must occur on the page, either exactly or with all whitespace removed (PDF extraction splits words). A ≥85% in-order token match is reported as *partially verified*, never as verified.

The value must then appear in a verbatim quotation: literally, or as the same amount (Indian units: lakh, crore), the same date (day-first numeric, written forms, ISO) or the same duration. Tables that print a bare number and state the unit once ("All Costs are in Lakhs") are accepted only when both excerpts are verbatim and cited on the same claim.

Claims backed only by a document the reporter uploaded are capped at `partially_verified`: the quote is in the file, but CivicProof cannot authenticate the file.

Results: `verified`, `partially_verified`, `unverified` (with reasons), and `contradicted` when two verified claims on a single-valued field disagree; both are shown.

## Policies

- `policies/agent-tools.cedar`: research tools allowed; selection limited to located candidates; official-record claims need citations; per-run budgets for reads, searches and claims; everything else denied.
- `policies/case-actions.cedar`: anyone may view, report and start an investigation within budget; only the reporter (owner key) may record submissions, responses, notes, edits and status; the agent may move a case only to `investigating`, `evidence_found` or `case_prepared`; a `forbid … unless` rule makes "submitted / awaiting response / resolved / closed" reachable only by the reporter even if another policy is written too broadly.

## Guardrails beyond Cedar

- `NeutralLanguageGuard` (Strands intervention): blocks accusatory terms in the model's own text and returns guidance to rephrase. Verbatim quotations from records are not blocked.
- Tool-call budget (40) and wall-clock limit (240 s on Bedrock) per run; investigations capped per case and per day.
- Optional Amazon Bedrock Guardrail via `BEDROCK_GUARDRAIL_ID`.

## Tests

- `tests/investigation.test.ts`: the full pipeline on real records (PMGSY road inside its maintenance window; BBMP road with a missing completion date; a location with no project).
- `tests/bedrock-agent.test.ts`: the Bedrock path through the Converse API against a local HTTP/2 stand-in that hallucinates a tender number, writes "corruption" and picks an unlocated project. The verifier, guard and Cedar each catch their case.
