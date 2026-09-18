# Research and product decisions

Research done on 18 Sep 2026, before building. Sources were opened and read, not taken from search snippets; the full notes with URLs are summarised here.

## 1. The event

First Commit (WeMakeDevs × AWS), 17–20 Sep 2026. Judged on idea and impact, use of AWS (mandatory), learning, execution ("does it work?") and a sub-three-minute demo video. The **Ship It** track asks for a live AWS URL; **Build It** accepts AWS open-source projects run locally (Strands, Cedar, SAM Local, OpenSearch). AI coding tools are allowed if listed. CivicProof targets Ship It, and its Strands + Cedar core also qualifies it for Build It.

## 2. Is this a clone?

Not of any one product, but the core loop "photo + GPS → responsible body → probable contract → complaint draft" exists:

| Product | What it does | What it doesn't |
|---|---|---|
| **Pothole Reporter** (Bengaluru, open source, Aug 2026) | Detects damage, routes to the urban local body, drafts an email with the *probable* tender number | Hides unverified leads instead of listing them as questions; no per-claim citations; no RTI or escalation; email is the only action |
| **Kerala PWD iROADS / PWD4U** (government) | Map of PWD roads with contractor, amount and defect-liability dates; geotagged complaints | Kerala PWD roads only; shows no source documents; no verified/unverified split; no RTI |
| **iWatchRoad v2** (NISER, 2025) | Dashcam pothole map; alerts contractors during warranty | Contract data typed in by officials, not discovered from public records |
| **FixMyStreet** (UK) | Pin → right council → public report | Stops at the council's inbox; no contract link |
| **DoZorro / ProZorro** (Ukraine), OCP tools | Contract-first monitoring, red flags | Needs clean OCDS data and a tender ID; no place-or-photo entry point |
| **Aleph, Datashare, DocumentCloud** | Investigative document tools with source-linked entities | For investigators, not citizens; no complaint output |
| **WhatDoTheyKnow, MuckRock** | FOI requests with statutory deadline tracking | No infrastructure or contract context |

And a warning: **bengaluru-road-contracts.pages.dev** was taken offline on 2 Sep 2026 after its scraper attached contractor names to the wrong tenders. Naming a contractor without an award document is a real credibility and defamation risk.

**CivicProof's distinct contribution** is the combination: a location entry point, a **per-claim evidence packet with an explicit verified / unverified / conflicting split enforced by code**, **RTI questions generated from specific gaps**, and **tracking on statutory clocks**. Borrowed patterns: FixMyStreet's pin-first flow, FollowTheMoney's "every entity carries its proof", DocumentCloud's page-level highlights, MuckRock's deadline-driven status machine.

## 3. Can the data be found?

Yes, for Bengaluru, with care (details in [DATA_SOURCES.md](DATA_SOURCES.md)):

- **PMGSY (rural roads, Bengaluru Urban)**: OMMAS exports give road, package, sanction cost, contractor, completion dates and stage; GeoSadak gives official line geometry; the Programme Guidelines give the 5-year same-contractor maintenance rule. All 12 Bengaluru Urban PMGSY-III roads are in their maintenance stage now, so a damaged one is directly actionable.
- **City roads**: the Karnataka Public Procurement Portal has a public JSON API with awarded works, the selected bidder, values, award dates and the tender PDF, which includes the road list and a 5-year defect liability clause (BBMP white-topping Package 2: MG Road, Residency Road…).
- **Smart City roads**: a BSCL status presentation (via OpenCity) and a CAG performance audit.
- Blocked or unreachable: eMARG and CPPP (captchas), bbmp.gov.in, smartcitybengaluru.in, pmgsy.nic.in.

## 4. Decisions

| Decision | Why |
|---|---|
| Keep the road focus, Bengaluru only | Real records exist and can be verified; breadth would mean fake or unverifiable data. |
| Curated, hash-checked corpus instead of a crawler | A crawler can't tell a tender from an award; the takedown above shows what that costs. Curated facts are re-verified on every build. |
| Model proposes, code verifies | The product's value is trust. Quotation-and-value checking is deterministic and testable. |
| Cedar for both agent tools and human actions | Makes "the AI can't submit or resolve a case" a policy, visible to judges, not a prompt instruction. |
| Rules planner as a Strands `Model` | The app must work without AWS credentials (Build It, local dev, tests) while exercising the same loop, policies and verifier. |
| Lambda + Web Adapter + streaming Function URL, not Amplify | Amplify compute supports Next.js ≤15, times out at 30 s and can't stream; the investigation view needs streaming. |
| Next actions and packets are deterministic | Legal-adjacent text must not contain model-invented facts. |
| Show near-ties and missing records | Uncertainty is information: an RTI for the missing completion certificate is often the most useful output. |
| Short, single-subject RTI drafts with no stated reasons | Karnataka RTI Rules 2005, rule 14: a request "shall relate to one subject matter and it shall not ordinarily exceed one hundred and fifty words" (inserted by the Karnataka Right to Information (Amendment) Rules, 2008, notified 17 Mar 2008; text as reproduced in the [mahitihakku discussion of the notification](https://groups.google.com/g/mahitihakku/c/qFK4r6GAFj4)). Section 6(2) of the Act says no reasons are required, so the draft gives none. |
