# Architecture

One Next.js 16 application (App Router, TypeScript). Pages and API routes run in the same Node.js server. Every AWS integration is selected by environment variables, so the same build runs on a laptop (files + rules planner) and on AWS (DynamoDB + S3 + Bedrock).

## Request paths

| Path | What happens |
|---|---|
| `POST /api/cases` | Multipart report. Zod validation, per-IP rate limit, 6 MB body cap (Lambda payload limit), magic-byte image check, SHA-256, store photos (S3), create case (DynamoDB). Returns the case id and a one-time **owner key** (only its SHA-256 is stored). |
| `POST /api/cases/:id/investigate` | Cedar `StartInvestigation` check against per-case and per-day budgets (DynamoDB atomic counter), then runs the agent and **streams NDJSON events** (stage, trace, claim, matches, complete). Progress is also persisted every 1.5 s so a dropped connection loses nothing. |
| `POST /api/cases/:id/timeline` | Owner-only (Cedar `RecordSubmission` / `RecordResponse` / `ChangeStatus` with `is_owner`). Records submissions, reference numbers, responses, follow-ups, status. |
| `POST /api/cases/:id/packet` | Drafts a complaint or RTI packet deterministically from verified facts; owners can save edits. |
| `POST /api/cases/:id/packet/pdf` | Renders the (possibly edited) packet with react-pdf, archives it to S3 under `packets/<case>/`, returns it with its SHA-256. |
| `GET /api/media/*` | Streams a photo from the private bucket (immutable, `nosniff`, restrictive CSP). |
| `GET /api/geocode` | Nominatim proxy with caching and ≤1 req/s. |

## Investigation pipeline

```
report
  └─ Strands Agent (BedrockModel: Claude | RulesPlanner: deterministic)
       ├─ BeforeToolCall → Cedar (policies/agent-tools.cedar)   deny → returned to model + shown in trace
       ├─ BeforeToolCall → NeutralLanguageGuard                  "guide" → model rephrases
       ├─ tools: get_case_report · find_projects_near · select_project · list_project_documents
       │         search_documents · read_document_page · record_claim · flag_missing
       │         propose_next_action · finish
       └─ record_claim → grounding verifier (src/lib/agent/verifier.ts)
  └─ finalize (deterministic): conflicts · maintenance window · missing checklist · next actions
  └─ status change authorized by policies/case-actions.cedar (agent may only reach investigation states)
```

## Storage

**DynamoDB, single table** (`infra/template.yaml`):

| Item | PK | SK | Other |
|---|---|---|---|
| Case | `CASE#<id>` | `CASE` | `doc` (full JSON), `version` (optimistic lock), `summary` (projection for lists), `GSI1PK=CASES`, `GSI1SK=<reportedAt>#<id>` |
| Counter | `COUNTER#<name>` | `COUNTER` | `count` (atomic `ADD`), `expiresAt` (TTL) |

Updates are read-modify-write with `ConditionExpression: version = :v`, retried on conflict (tested with concurrent writers in `tests/dynamo.test.ts`).

**S3**: `photos/<case>/<sha>.jpg`, `packets/<case>/<kind>-<sha>.pdf`. Private, SSE-S3, versioned, TLS-only bucket policy.

**Corpus**: bundled with the function (`corpus/generated/pages.json`, `projects.json`, `authorities.json`, `geometry/projects.geojson`), built by `npm run ingest`, which runs before every build.

## Deployment shape

- `output: "standalone"` Next.js build, laid out by `scripts/package-lambda.sh` into `.lambda/`.
- Lambda `nodejs22.x`, arm64, 2 GB, 300 s timeout, Lambda Web Adapter layer (`LambdaAdapterLayerArm64:28`), `AWS_LWA_INVOKE_MODE=response_stream`.
- Function URL, `AuthType: NONE`, `InvokeMode: RESPONSE_STREAM`, plus an explicit `lambda:InvokeFunction` permission conditioned on `InvokedViaFunctionUrl` (required for public URLs since October 2025).
- Why not Amplify Hosting: its compute supports Next.js up to 15, times out SSR at 30 s and does not support streaming responses, which would break the live investigation view.

## Observability

Structured JSON log lines (`src/lib/log.ts`) for `case.created`, `investigation.start|complete|failed|denied`, `packet.pdf`, `case.timeline`, `api.error`. CloudWatch metric filters count failed and budget-denied investigations; an alarm fires on 5+ Lambda errors in 5 minutes.

Example Logs Insights query:

```
fields @timestamp, event, caseId, engine, verifiedOfficial, inputTokens, outputTokens
| filter event like /investigation/
| sort @timestamp desc
```
