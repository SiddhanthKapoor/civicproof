/**
 * On AWS the Gemini key lives in Secrets Manager. The client talks to a local stand-in that speaks
 * the Secrets Manager JSON protocol; the key is fetched once and cached.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

const calls: Array<{ target?: string; body: { SecretId?: string } }> = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ target: req.headers["x-amz-target"] as string, body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "application/x-amz-json-1.1" });
      res.end(JSON.stringify({ ARN: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:gemini-AbCdEf", Name: "gemini", SecretString: "key-from-secrets-manager\n" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("CIVICPROOF_PLANNER", "");
  vi.stubEnv("GEMINI_SECRET_ARN", "arn:aws:secretsmanager:ap-south-1:123456789012:secret:gemini-AbCdEf");
  vi.stubEnv("SECRETS_MANAGER_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Gemini key from AWS Secrets Manager", () => {
  it("selects Gemini, fetches the secret once and caches it", async () => {
    const { config } = await import("@/lib/config");
    const { geminiApiKey } = await import("@/lib/secrets");
    expect(config.planner).toBe("gemini");
    expect(await geminiApiKey()).toBe("key-from-secrets-manager");
    expect(await geminiApiKey()).toBe("key-from-secrets-manager");
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe("secretsmanager.GetSecretValue");
    expect(calls[0].body.SecretId).toContain("secret:gemini");
  });
});
