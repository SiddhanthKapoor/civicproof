/**
 * Model API keys. Locally they come from the environment (.env.local). On AWS the Gemini key is
 * kept in AWS Secrets Manager and the function's role may read only that one secret; it is fetched
 * on first use and cached for the life of the Lambda instance (refreshed after 15 minutes).
 */
import "server-only";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config } from "@/lib/config";

let client: SecretsManagerClient | undefined;
let cached: { value: string; at: number } | undefined;
const TTL_MS = 15 * 60 * 1000;

export async function geminiApiKey(): Promise<string | undefined> {
  if (config.geminiApiKey) return config.geminiApiKey;
  if (!config.geminiSecretArn) return undefined;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  client ??= new SecretsManagerClient({
    region: config.region,
    ...(config.secretsEndpoint ? { endpoint: config.secretsEndpoint, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}),
  });
  const res = await client.send(new GetSecretValueCommand({ SecretId: config.geminiSecretArn }));
  const value = res.SecretString?.trim();
  if (!value) throw new Error("The Gemini API key secret is empty.");
  cached = { value, at: Date.now() };
  return value;
}
