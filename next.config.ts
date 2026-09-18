import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for AWS Lambda (see infra/ and scripts/package-lambda.sh).
  output: "standalone",
  // Loaded from node_modules at runtime: Cedar ships WebAssembly that it reads from disk,
  // and the Strands SDK optionally imports it.
  serverExternalPackages: ["@cedar-policy/cedar-wasm", "@cedar-policy/mcp-schema-generator-wasm", "@strands-agents/sdk", "@react-pdf/renderer"],
  // Files read with fs at runtime must be traced into the standalone output.
  outputFileTracingIncludes: {
    "/**": [
      "./corpus/manifest.json",
      "./corpus/projects.json",
      "./corpus/authorities.json",
      "./corpus/generated/pages.json",
      "./corpus/geometry/projects.geojson",
      "./policies/*.cedar",
      "./node_modules/@cedar-policy/cedar-wasm/nodejs/**",
      "./node_modules/@cedar-policy/mcp-schema-generator-wasm/**",
    ],
  },
  // process.cwd()-relative reads make the tracer conservative; keep raw PDFs and local data out.
  // (Top-level src/ etc. are removed by scripts/package-lambda.sh; a "src/**" glob here would also
  // match packages' own dist/src folders.)
  outputFileTracingExcludes: {
    "/**": ["./corpus/documents/**", "./corpus/geometry/raw/**", "./.data/**", "./.lambda/**"],
  },
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
