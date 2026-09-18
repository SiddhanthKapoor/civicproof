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

  /**
   * Which model drives the investigator:
   *   "gemini"  – Google Gemini (needs GEMINI_API_KEY; the default when that key is set)
   *   "bedrock" – a model on Amazon Bedrock (needs AWS credentials with bedrock:InvokeModel*)
   *   "rules"   – no language model: fixed rules replaying the curated extractions (tests, offline demo)
   */
  planner: (env("CIVICPROOF_PLANNER") ?? (env("GEMINI_API_KEY") || env("GEMINI_SECRET_ARN") ? "gemini" : "rules")) as "rules" | "bedrock" | "gemini",
  /** Local: the key itself. On AWS: GEMINI_SECRET_ARN names a Secrets Manager secret instead (lib/secrets.ts). */
  geminiApiKey: env("GEMINI_API_KEY"),
  geminiSecretArn: env("GEMINI_SECRET_ARN"),
  /** Test-only: point the Secrets Manager client at a local stand-in. */
  secretsEndpoint: env("SECRETS_MANAGER_ENDPOINT"),
  geminiModelId: env("GEMINI_MODEL_ID") ?? "gemini-3-flash-preview",
  /** Longest a model-driven investigation may run. Free-tier rate limits make runs slower. */
  runTimeoutMs: Number(env("CIVICPROOF_RUN_TIMEOUT_S") ?? 240) * 1000,
  /** Test-only: point the Gemini client at a local stand-in. */
  geminiEndpoint: env("GEMINI_ENDPOINT"),
  bedrockModelId: env("BEDROCK_MODEL_ID") ?? "apac.amazon.nova-pro-v1:0",
  /** A Bedrock model a Gemini run continues on when Gemini is unavailable (set on AWS; unset locally). */
  fallbackModelId: env("CIVICPROOF_FALLBACK_MODEL"),
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
  /** "amazon-location" (Amazon Location Service Places API, on AWS), "nominatim" (local) or "none" (tests). */
  geocoder: (env("CIVICPROOF_GEOCODER") ?? "nominatim") as "amazon-location" | "nominatim" | "none",
  /** Test-only: point the Amazon Location client at a local stand-in. */
  locationEndpoint: env("LOCATION_ENDPOINT"),
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
