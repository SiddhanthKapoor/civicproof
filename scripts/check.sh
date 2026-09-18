#!/usr/bin/env bash
# Everything a commit should pass: types, lint, unit/integration tests, and (if a server is up) e2e.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
npx eslint --max-warnings=0 >/dev/null || npx eslint
npx vitest run --reporter=dot
if curl -fsS "${BASE_URL:-http://localhost:3000}/api/health" >/dev/null 2>&1; then
  BASE_URL="${BASE_URL:-http://localhost:3000}" npx playwright test --reporter=line
else
  echo "(no server on ${BASE_URL:-http://localhost:3000}; skipping e2e)"
fi
