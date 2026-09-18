#!/usr/bin/env bash
# Deploys CivicProof to AWS with SAM, then seeds the demo reports into DynamoDB.
#   Prereqs: AWS CLI + SAM CLI, credentials (aws configure / SSO), Bedrock model access in the region.
#   Usage:   ./scripts/deploy.sh            (first run is guided and writes samconfig.toml)
#            SEED=0 ./scripts/deploy.sh     (skip seeding)
set -euo pipefail
cd "$(dirname "$0")/.."
command -v sam >/dev/null || { echo "Install the AWS SAM CLI first: brew install aws-sam-cli"; exit 1; }
aws sts get-caller-identity >/dev/null || { echo "No AWS credentials. Run 'aws configure' or 'aws sso login'."; exit 1; }

STACK="${STACK:-civicproof}"
REGION="${AWS_REGION:-ap-south-1}"

./scripts/package-lambda.sh
sam validate --lint -t infra/template.yaml --region "$REGION"

if [ -f samconfig.toml ]; then
  sam deploy -t infra/template.yaml --stack-name "$STACK" --region "$REGION" --capabilities CAPABILITY_IAM --resolve-s3 --no-fail-on-empty-changeset
else
  sam deploy -t infra/template.yaml --stack-name "$STACK" --region "$REGION" --capabilities CAPABILITY_IAM --resolve-s3 --guided
fi

out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
URL=$(out AppUrl); TABLE=$(out TableName); BUCKET=$(out BucketName)
echo "App:    $URL"
echo "Table:  $TABLE"
echo "Bucket: $BUCKET"

if [ "${SEED:-1}" = "1" ]; then
  echo "Seeding demo reports into DynamoDB…"
  AWS_REGION="$REGION" CIVICPROOF_STORE=dynamodb CIVICPROOF_TABLE="$TABLE" CIVICPROOF_BLOBS=s3 CIVICPROOF_BUCKET="$BUCKET" CIVICPROOF_PLANNER=rules npm run seed
fi
curl -fsS "${URL%/}/api/health" && echo
