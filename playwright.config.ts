import { defineConfig } from "@playwright/test";

// E2E against a running server: BASE_URL=http://localhost:3000 npx playwright test
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  // The dev server compiles a route on its first request, which can take several seconds.
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  reporter: [["list"]],
});
