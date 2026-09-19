#!/usr/bin/env bash
# Everything a commit should pass, in the order the toolchain actually requires.
#
# The build comes first on purpose: `next build` generates the route/page types that `tsc` needs,
# so on a fresh clone a typecheck run before it fails on globals that do not exist yet. Building
# first also means a broken build is reported as a broken build rather than as phantom type errors.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ build (also regenerates the corpus and the generated Next types)"
npm run build

echo "→ typecheck"
npx tsc --noEmit

echo "→ lint"
npx eslint --max-warnings=0

echo "→ unit and integration tests"
npx vitest run --reporter=dot

echo "→ evaluation (deterministic replay; fails below its thresholds)"
npm run eval

if curl -fsS "${BASE_URL:-http://localhost:3000}/api/health" >/dev/null 2>&1; then
  echo "→ browser tests"
  BASE_URL="${BASE_URL:-http://localhost:3000}" npx playwright test --reporter=line
else
  echo "→ browser tests skipped (no server on ${BASE_URL:-http://localhost:3000}; run 'npm start' to include them)"
fi
