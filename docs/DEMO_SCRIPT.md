# Three-minute demo script

Target: under 3:00, recorded at 1440×900, deployed URL, `Planner=bedrock`. Have one real photo of a damaged road ready (ideally on a PMGSY road such as Kodathi–Mullur, or anywhere, to show the "not found" path).

| Time | Screen | Say (roughly) |
|---|---|---|
| 0:00–0:15 | Landing page hero | "Reporting a broken road is easy. Finding the contract, the contractor and whether they still owe the repair is not. CivicProof turns a report into a case you can act on." |
| 0:15–0:40 | **Report an issue** → upload photo (GPS fills the pin) → Pothole → title → **Create case** | "No account. The photo's location and time are read in the browser and the file is fingerprinted." Point at the owner-key notice. |
| 0:40–1:20 | Case page, **investigation streaming** | "This is Google Gemini, running as a Strands agent. It finds the project at this spot, reads the official records, and records each fact with a quotation. Every tool call passes a Cedar policy first." Point at a verified line and, if it appears, a rejected or denied line. |
| 1:20–1:50 | **Evidence** section → open a source (document viewer with highlight) | "The contractor's name counts only because these exact words are on page 1 of the OMMAS report. Anything the verifier can't find stays unverified. This road was completed in March 2022 with a 5-year maintenance contract, so the damage is inside the window." |
| 1:50–2:20 | **What to do next** → **Draft the complaint** → edit a line → **Download PDF**; flip to **RTI draft** | "Next steps come from verified facts only. The complaint cites its sources. The RTI asks for exactly the records that are missing." |
| 2:20–2:35 | Back to case → **Tracking** → Record a submission (channel + reference) | "When you file it, record the reference. The timeline shows when a reply is due. The agent can't mark anything submitted or resolved: that's a Cedar rule." |
| 2:35–2:55 | **How it works** → architecture diagram, Cedar policy | "Next.js on Lambda with a streaming Function URL, Bedrock, DynamoDB, S3, CloudWatch, deployed with SAM. Strands and Cedar are AWS open source." |
| 2:55–3:00 | Landing | "CivicProof turns a reported civic problem into a documented, actionable case." |

Backup if Bedrock is slow: open the seeded demo case "Potholes along the Kodathi–Mullur road" and click **Run again**.

Upload to YouTube as unlisted or public, and check the link while logged out.
