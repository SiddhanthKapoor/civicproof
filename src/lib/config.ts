/**
 * Server-side configuration. Read once from the environment; never imported by client code.
 * Every AWS integration is opt-in by environment so the app runs end-to-end on a laptop
 * with no AWS account (local JSON store + filesystem blobs + rules-based planner).
 */
import "server-only";
import path from "node:path";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

const dataDir = env("CIVICPROOF_DATA_DIR") ?? path.join(process.cwd(), ".data");

export const config = {
  region: env("AWS_REGION") ?? env("AWS_DEFAULT_REGION") ?? "ap-south-1",

  store: (env("CIVICPROOF_STORE") ?? "local") as "local" | "dynamodb",
  tableName: env("CIVICPROOF_TABLE") ?? "civicproof",

  blobs: (env("CIVICPROOF_BLOBS") ?? "local") as "local" | "s3",
  bucket: env("CIVICPROOF_BUCKET"),

  dataDir,

  /** "bedrock" requires AWS credentials with bedrock:InvokeModel* on the model below. */
  planner: (env("CIVICPROOF_PLANNER") ?? "rules") as "rules" | "bedrock",
  bedrockModelId: env("BEDROCK_MODEL_ID") ?? "global.anthropic.claude-opus-5",
  bedrockRegion: env("BEDROCK_REGION") ?? env("AWS_REGION") ?? "ap-south-1",
  /** Test-only: point the Bedrock client at a local Converse-compatible endpoint. */
  bedrockEndpoint: env("BEDROCK_ENDPOINT"),

  /** OCR for scanned uploads: "textract" (Amazon Textract) or "none". */
  ocr: (env("CIVICPROOF_OCR") ?? "none") as "textract" | "none",
  /** Test-only: point the Textract client at a local stand-in. */
  textractEndpoint: env("TEXTRACT_ENDPOINT"),

  /** Hard ceilings that protect the Bedrock budget on a public deployment. */
  maxInvestigationsPerCase: Number(env("CIVICPROOF_MAX_RUNS_PER_CASE") ?? 5),
  maxInvestigationsPerDay: Number(env("CIVICPROOF_MAX_RUNS_PER_DAY") ?? 150),
  maxAgentToolCalls: Number(env("CIVICPROOF_MAX_TOOL_CALLS") ?? 40),

  maxPhotoBytes: 8 * 1024 * 1024,
  maxPhotos: 4,

  /** Contact string sent to OpenStreetMap Nominatim, per its usage policy. */
  nominatimContact: env("NOMINATIM_CONTACT") ?? "civicproof-hackathon",
} as const;

export type AppConfig = typeof config;

export function describeRuntime() {
  return {
    store: config.store,
    blobs: config.blobs,
    planner: config.planner,
    model: config.planner === "bedrock" ? config.bedrockModelId : undefined,
    region: config.region,
  };
}
