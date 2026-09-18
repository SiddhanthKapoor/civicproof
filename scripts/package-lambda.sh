#!/usr/bin/env bash
# Builds the Next.js standalone server and lays it out for AWS Lambda + Lambda Web Adapter.
# Output: .lambda/  (referenced by infra/template.yaml as CodeUri)
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

rm -rf .lambda
cp -RL .next/standalone .lambda
mkdir -p .lambda/.next
cp -R .next/static .lambda/.next/static
cp -R public .lambda/public

# Files read at runtime (also traced by outputFileTracingIncludes; copied explicitly to be sure).
mkdir -p .lambda/corpus/generated .lambda/corpus/geometry .lambda/policies
cp corpus/manifest.json corpus/projects.json corpus/authorities.json .lambda/corpus/
cp corpus/generated/pages.json .lambda/corpus/generated/
cp corpus/geometry/projects.geojson .lambda/corpus/geometry/
cp policies/*.cedar .lambda/policies/

# Local data, sources and tests never ship (the server runs from .next/ only).
rm -rf .lambda/.data .lambda/.env* .lambda/src .lambda/scripts .lambda/tests .lambda/infra .lambda/docs .lambda/corpus/documents 2>/dev/null || true

cat > .lambda/run.sh <<'RUN'
#!/bin/bash
# Started by the Lambda Web Adapter (AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap).
export HOSTNAME=127.0.0.1
export PORT="${PORT:-8080}"
exec node server.js
RUN
chmod +x .lambda/run.sh

du -sh .lambda | awk '{print "Lambda bundle: " $1}'
test -f .lambda/node_modules/@cedar-policy/cedar-wasm/nodejs/cedar_wasm_bg.wasm && echo "Cedar WASM: present" || { echo "Cedar WASM missing"; exit 1; }
