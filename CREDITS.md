# Credits

## Code and libraries
| Project | Use | Licence |
|---|---|---|
| [Next.js](https://nextjs.org) / React | App framework | MIT |
| [Strands Agents (TypeScript)](https://github.com/strands-agents/harness-sdk) | Agent loop, Bedrock model provider, Cedar intervention | Apache-2.0 |
| [Cedar](https://www.cedarpolicy.com) (`@cedar-policy/cedar-wasm`) | Authorization policies | Apache-2.0 |
| AWS SDK for JavaScript v3 | DynamoDB, S3, Bedrock Runtime | Apache-2.0 |
| [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) | Runs Next.js on Lambda (layer) | Apache-2.0 |
| [Motion](https://motion.dev) | Animation | MIT |
| [Motion Primitives](https://motion-primitives.com) by ibelick (`src/components/motion-primitives/`) | Animated group, text shimmer, border trail and others, vendored with small type fixes | MIT |
| [MapLibre GL JS](https://maplibre.org) | Maps | BSD-3-Clause |
| [react-pdf](https://react-pdf.org) | Packet PDFs | MIT |
| [unpdf](https://github.com/unjs/unpdf) (pdf.js) | PDF text extraction at ingest | MIT / Apache-2.0 |
| [MiniSearch](https://github.com/lucaong/minisearch) | Full-text search over pages | MIT |
| [exifr](https://github.com/MikeKovarik/exifr) | Photo EXIF in the browser | MIT |
| [Zod](https://zod.dev), clsx, tailwind-merge, Tailwind CSS | Validation and styling | MIT |
| [dynalite](https://github.com/architect/dynalite), Vitest, Playwright | Tests | MIT / Apache-2.0 |

## Fonts
Newsreader (Production Type), Instrument Sans (Instrument), IBM Plex Mono (IBM) — SIL Open Font License, served via `next/font/google`.

## Maps and geodata
- Basemap tiles: [OpenFreeMap](https://openfreemap.org), © [OpenMapTiles](https://openmaptiles.org), data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
- City road alignments in `corpus/geometry/`: traced from OpenStreetMap via the Overpass API (ODbL). Queries are in `corpus/geometry/raw/`.
- PMGSY road alignments: GeoSadak PRCD 2022 via [datameet/pmgsy-geosadak](https://github.com/datameet/pmgsy-geosadak), Government Open Data License – India.
- Address search: [Nominatim](https://nominatim.org) (OpenStreetMap), used within its usage policy.

## Documents
See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for every document, publisher, URL, retrieval date, SHA-256 and terms.
