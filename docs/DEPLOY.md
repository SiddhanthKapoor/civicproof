# Deploying to AWS

## Prerequisites

1. An AWS account (the event provides credits for the Ship It track).
2. AWS CLI v2 and AWS SAM CLI: `brew install awscli aws-sam-cli` (both are installed on the build machine).
3. Credentials: `aws configure` (access key) or `aws configure sso` then `aws sso login`.
4. **A Gemini key** in `.env.local` (`GEMINI_API_KEY=...`); `deploy.sh` passes it to the function. Enable billing on the key's Google project for a public URL: the free tier allows about 20 requests per model per day. Or, to use Bedrock instead, deploy with `Planner=bedrock` and set up **Amazon Bedrock model access**: in the Bedrock console for your region (default `ap-south-1`, Mumbai), enable the model you intend to use. The default model ID is the Asia-Pacific cross-region inference profile `apac.amazon.nova-pro-v1:0` (Amazon Nova Pro); any Bedrock model or inference profile you have access to works (`BedrockModelId` parameter).

## One command

```bash
./scripts/deploy.sh
```

It will:

1. `npm run build` (which first re-runs `npm run ingest`, so a changed or tampered document fails the build) and lay out `.lambda/`.
2. `sam validate --lint`.
3. `sam deploy` (guided the first time: accept the defaults, answer **Yes** to "AppFunction Function Url has no authentication. Is this okay?", since the app is public by design).
4. Seed the six demo reports into DynamoDB (`SEED=0` to skip).
5. Print the URL and call `/api/health`.

Stack name and region: `STACK=civicproof AWS_REGION=ap-south-1 ./scripts/deploy.sh`.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `Planner` | `bedrock` | `rules` runs without model calls (no Bedrock cost). |
| `BedrockModelId` | `apac.amazon.nova-pro-v1:0` | Model or inference profile for the investigator and photo description. |
| `MaxRunsPerDay` | 150 | Deployment-wide daily cap on investigations. |
| `MaxRunsPerCase` | 5 | Cap per case. |
| `NominatimContact` | `civicproof-hackathon` | Put an email here, per Nominatim's usage policy. |
| `LogRetentionDays` | 30 | CloudWatch Logs retention. |

Change them with `sam deploy --parameter-overrides Planner=rules`.

## Verify

```bash
URL=$(aws cloudformation describe-stacks --stack-name civicproof --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" --output text)
curl "$URL/api/health"            # runtime: store=dynamodb, blobs=s3, planner=bedrock
```

Then open the URL, report something on a PMGSY road (e.g. near Kodathi, off Sarjapur Road) and watch the investigation stream.

Logs: CloudWatch › Log groups › the `AppLogGroup` output. Useful query:

```
fields @timestamp, event, caseId, engine, verifiedOfficial, inputTokens, outputTokens, error
| filter ispresent(event)
| sort @timestamp desc
```

## Cost notes

- Lambda, DynamoDB on-demand, S3, Textract (only for scanned uploads) and CloudWatch at demo volumes: cents.
- Bedrock is the variable: one investigation is roughly 15–25 model turns over a small corpus, and each turn re-sends the conversation. Prompt caching is on (tools, system prompt and conversation prefix), so repeated context is billed at the cache-read rate. Run `CIVICPROOF_PLANNER=bedrock npm run eval` once to see real token counts, use `MaxRunsPerDay` to cap spend, or `Planner=rules` for a zero-model deployment.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Investigation fails with `AccessDeniedException` | Enable model access for the model in that region, or set `BedrockModelId` to one you have. |
| `ValidationException … inference profile` | Use an inference profile ID (e.g. `global.…` / `apac.…`) rather than a bare model ID, or vice versa, as the model requires. |
| 403 on the URL | Check the stack created `AppFunctionUrlInvokePermission` (needed for public Function URLs since Oct 2025). |
| Map tiles missing | The browser must reach `tiles.openfreemap.org`. |

## Teardown

```bash
sam delete --stack-name civicproof
```

The DynamoDB table and S3 bucket have `DeletionPolicy: Retain` so case data survives an accidental delete; remove them manually from the console if you really want them gone.
