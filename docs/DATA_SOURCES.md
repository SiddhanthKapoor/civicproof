# Data sources

Everything CivicProof states as a verified fact is a quotation from one of these documents. All were retrieved on 18 Sep 2026 from public sources without login or captcha.

## Documents (`corpus/manifest.json`)

| ID | Title | Publisher | URL | Retrieved | SHA-256 |
|---|---|---|---|---|---|
| `ommas-slr-pmgsy3-bangalore-urban` | SLR: Statewise List of Works — Karnataka, Bangalore U, PMGSY-III | NRIDA, Ministry of Rural Development (OMMAS citizen reports) | [link](https://pmgsy.dord.gov.in/ProposalArea/Proposal/StateListWiseRoadsLayout) | 2026-09-18 | `26a6fb268acbdfb9…` |
| `ommas-quality-grading-bangalore-urban` | Works Wise Grading Abstract — NQM/SQM inspections, Bangalore U, Jan 2021 to Sep 2026 | NRIDA, Ministry of Rural Development (OMMAS citizen reports) | [link](https://pmgsy.dord.gov.in/QualityMonitoringArea/QualityMonitoring/QMMonWorksDetailLayout) | 2026-09-18 | `1ed0da333971bef2…` |
| `pmgsy-programme-guidelines` | Pradhan Mantri Gram Sadak Yojana — Programme Guidelines | Ministry of Rural Development, Government of India | [link](https://pmgsy.dord.gov.in/ReferenceDocs/PMGSY_Guidelines.pdf) | 2026-09-18 | `e94a8eaba3392497…` |
| `kppp-bbmp-wt-pkg2-bid` | Tender document — White Topping of Selected Roads under GoK Grants, Package-2 (BBMP, Project Central-8) | Bruhat Bengaluru Mahanagara Palike, via Karnataka Public Procurement Portal | [link](https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service/59700/works-tender-file/d05b1383-c226-4494-862a-f8d030a7e94a/download-file) | 2026-09-18 | `ed2b9e29e16e1b4f…` |
| `kppp-bbmp-wt-pkg2-award` | KPPP selected-bid (award) record — tender BBMP/2023-24/RD/WORK_INDENT1733 | Karnataka Public Procurement Portal (Government of Karnataka) | [link](https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service/bids/59700/tender-category/WORKS/get-selected-bid-for-lumpsum) | 2026-09-18 | `128e142ae3ca9ebd…` |
| `kppp-bbmp-wt-pkg2-tender` | KPPP tender record (full view) — BBMP/2023-24/RD/WORK_INDENT1733 | Karnataka Public Procurement Portal (Government of Karnataka) | [link](https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service/59700/works-tender-full-view) | 2026-09-18 | `4f0b23afbab59bd0…` |
| `bscl-tender-sure-status-2021` | Tender SURE Phase A roads — project status presentation (Feb 2021) | Bengaluru Smart City Limited (copy hosted by OpenCity.in) | [link](https://data.opencity.in/dataset/865313bc-c287-406a-be69-1b23c8392fca/resource/adb616c4-1f8a-4d39-93c7-53f651caf783/download/1d272e9b-4926-4ffc-836f-01c476ac5022.pdf) | 2026-09-18 | `90c43c0f22d4ddad…` |
| `cag-karnataka-2025-11` | CAG Report No. 11 of 2025 — Implementation of Smart City Mission, Government of Karnataka | Comptroller and Auditor General of India | [link](https://cag.gov.in/ag1/karnataka/en/audit-report) | 2026-09-18 | `275e0254bc4276bf…` |
| `datagovin-pmgsy3-karnataka` | District-wise road works sanctioned under PMGSY-III in Karnataka (as on 10 Mar 2023) | Rajya Sabha, via Open Government Data Platform India | [link](https://api.data.gov.in/resource/e8ccbaa7-f9eb-4ebb-9f4e-3ff34a102b6b) | 2026-09-18 | `9d042bcc07ffbbdb…` |

Full hashes are in `corpus/manifest.json`; `npm run ingest` refuses to build if a file's hash changes.

## Projects (`corpus/projects.json`)

| Project | Records | Geometry |
|---|---|---|
| Six PMGSY-III roads in Bengaluru Urban (KN03-62, -63, -65, -67, -69, -70) | OMMAS road list (package, sanction cost, contractor, completion dates, stage), OMMAS quality grades, PMGSY Guidelines para 17.2 (5-year maintenance with the same contractor) | GeoSadak PRCD 2022 lines, matched by package number and road name (official) |
| BBMP White Topping, GoK Grants 2023-24, Package 2 (MG Road, Residency Road and four others) | KPPP tender document (scope, 5-year defect liability, roads), KPPP award record (selected bidder, negotiated value), KPPP tender record (department, award date) | OpenStreetMap traces by road name (approximate) |
| Bengaluru Smart City Tender SURE Phase A, Package 7 (RRM Road, Lavelle Road, Brigade Road) | BSCL status presentation (agency, cost, work order date, status), CAG Report 11/2025 (audit finding on smart roads) | OpenStreetMap traces by road name (approximate) |

Each project carries curated reference fields (85 in total), each with a verbatim quotation and page number. They are re-verified on every build.

## How each source was obtained

- **OMMAS** (pmgsy.dord.gov.in): citizen reports rendered by the report viewer and exported as PDF (Karnataka › Bangalore U › PMGSY-III). `omms.nic.in` no longer resolves.
- **KPPP** (kppp.karnataka.gov.in): the portal's public JSON API (`works-tender-full-view`, `get-selected-bid-for-lumpsum`, `works-tender-file/…/download-file`). JSON responses are rendered deterministically into `field: value` lines at ingest; epoch timestamps and E-notation amounts are annotated with readable values.
- **BSCL presentation**: BSCL's own site did not resolve; the copy is from OpenCity.in's data portal and is labelled as such.
- **CAG**: Report No. 11 of 2025 PDF from the CAG Karnataka audit-report page.
- **data.gov.in**: used only as a cross-check (Bangalore U: 12 roads, 108.44 km, matches OMMAS).

## Checked but not used

- eMARG "Know Your Road" and CPPP results of tenders: behind captchas (not bypassed).
- bbmp.gov.in, site.bbmp.gov.in, smartcitybengaluru.in, pmgsy.nic.in: unreachable on 18 Sep 2026.
- OpenCity BBMP work-orders CSV: useful, but secondary and includes contractors' phone numbers; left out.
- B-SMILE Package 6 (awarded 17 Sep 2026): real and verifiable, but no road-level locations yet.

## Terms and caveats

- **OMMAS** reports carry "2014 NRRDA, All rights reserved", and the portal's legal notice restricts republication without NRIDA's permission. They are included only so quotations can be checked, with attribution and a link to the official portal. **Decide before publishing the repository publicly** whether to keep these PDFs or replace them with a fetch script.
- **KPPP, BSCL, CAG, PMGSY Guidelines**: public government records, quoted and linked for public-interest verification.
- **GeoSadak** via datameet: Government Open Data License – India. **OpenStreetMap**: ODbL.
- Demo reports are illustrative and labelled; no report has been filed with any authority.
- Maintenance-window end dates are **computed** (completion date + stated period) and labelled as computed; the dates in brackets beside OMMAS contractor names are unlabelled in the source and are not used.
