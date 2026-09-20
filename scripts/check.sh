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

BASE="${BASE_URL:-http://localhost:3000}"
if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
  # The build above replaced .next under whatever server is already running. `next start` keeps the
  # old build's manifest in memory, so it goes on serving HTML that asks for chunks the rebuild
  # deleted; those 404/500, hydration dies, and the browser tests fail in ways that look like
  # product faults and are not. Catch it here and say so, rather than reporting phantom failures.
  stale=""
  for chunk in $(curl -fsS "$BASE/report" 2>/dev/null | grep -oE '/_next/static/chunks/[A-Za-z0-9_.-]+\.js' | sort -u | head -20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$chunk")
    [ "$code" = "200" ] || stale="$stale $chunk($code)"
  done
  if [ -n "$stale" ]; then
    echo "→ browser tests SKIPPED: the server on $BASE is serving an older build."
    echo "  The build in this run replaced .next underneath it, so these assets no longer resolve:$stale"
    echo "  Restart it ('npm start') and re-run, or run the browser tests on their own:"
    echo "    BASE_URL=$BASE npx playwright test"
    exit 1
  fi
  echo "→ browser tests"
  BASE_URL="$BASE" npx playwright test --reporter=line
else
  echo "→ browser tests skipped (no server on $BASE; run 'npm start' to include them)"
fi
