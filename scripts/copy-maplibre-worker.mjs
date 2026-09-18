// MapLibre v6 loads its tile worker as an ES module next to the main bundle. Bundlers rename
// that chunk, so the worker (and the shared chunk it imports) are served from /public instead.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
console.log("maplibre worker copied to public/maplibre/");
