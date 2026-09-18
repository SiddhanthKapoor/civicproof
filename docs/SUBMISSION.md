# Submission writeup (draft)

> Draft for the First Commit submission form. Edit before submitting: team details, the deployed URL and the video link are placeholders to fill in.

**Project:** CivicProof
**Track:** Ship It (live on AWS). Also eligible for Build It (Strands Agents + Cedar + SAM), and Best UI.
**Live URL:** _add after `./scripts/deploy.sh`_
**Video:** _add YouTube link_
**Repository:** _add GitHub link_

## What it does

CivicProof turns a report of a damaged road into an evidence-backed case. A citizen drops a pin and a photo; an agent built with Strands Agents and Claude on Amazon Bedrock finds the public-works project at that spot, reads the official tender, award and completion records, and records each fact with a quotation. A deterministic verifier accepts a fact only if the quoted words are on the cited page and contain the value. The result is a case file that separates verified facts, reported observations, AI suggestions and missing information, a neutral complaint that cites its sources, an RTI application for exactly the records that are missing, and a timeline that tracks when replies are due.

## Who it is for

Residents, resident associations, ward volunteers and local journalists who already complain and file RTIs, and lose hours working out which office, which contract and which record to ask for.

## How AWS is used

- **Amazon Bedrock**: Claude via the Converse API for the investigation (tool use) and photo description (vision).
- **Strands Agents** (AWS open source): the agent loop, Bedrock provider, hooks, and its Cedar intervention.
- **Cedar** (AWS open source): policies on every agent tool call and every change to a case. The agent cannot mark a case submitted or resolved.
- **AWS Lambda** with the Lambda Web Adapter and a response-streaming Function URL, so each agent step streams to the browser.
- **Amazon Textract** to read scanned RTI replies so they can be quoted.
- **Amazon DynamoDB** for cases (optimistic locking) and budget counters; **Amazon S3** for photos and packet PDFs; **Amazon CloudWatch** for structured logs, an alarm and metric filters; **AWS SAM** for least-privilege infrastructure as code.

## What is real

The records are real: 9 public documents (OMMAS PMGSY-III reports and guidelines, Karnataka Public Procurement Portal tender and award records for a BBMP white-topping package, a Bengaluru Smart City status presentation, a CAG audit), 85 curated facts re-verified on every build. Demo reports are labelled as illustrative. Nothing is filed with any authority on anyone's behalf.

## What I learned

_Fill in your own words. Candidates: running Next.js on Lambda with response streaming; Cedar as an agent permission layer; why "model proposes, code verifies" beats prompting for accuracy; how scattered Indian public-works records actually are, and which portals have usable APIs._

## AI tools used

- Claude Code (Anthropic) as a coding assistant for research, implementation, tests and documentation.
- The application calls Claude on Amazon Bedrock at runtime.

## Open-source credits

See CREDITS.md. Motion Primitives components are vendored under MIT; map data © OpenStreetMap contributors (ODbL); PMGSY geometry from GeoSadak (GODL-India).
