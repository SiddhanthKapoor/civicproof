import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or vendored output.
    ".lambda/**",
    ".data/**",
    "public/maplibre/**",
    "corpus/**",
    // Local scratch worktrees from other tooling. Committed here rather than relying on a
    // developer's .git/info/exclude, so `npm run lint` is the same for everyone.
    ".kilo/**",
    ".kilocode/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    // Vendored from motion-primitives.com; kept close to upstream.
    files: ["src/components/motion-primitives/**"],
    rules: { "react-hooks/static-components": "off", "react-hooks/refs": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
