import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against an ISOLATED database (scripts/reset-test-db.mjs
// creates + pushes `f3redirect_test`), never the shared `f3_test` that
// @acme/db owns and resets. Derive that dedicated URL from whatever server the
// env points at (CI's f3_test service, or the local docker Postgres).
function dedicatedTestDbUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ??
    "postgresql://f3local:f3local@localhost:5433/f3nation";
  const u = new URL(base);
  u.pathname = "/f3redirect_test";
  return u.toString();
}

export default defineConfig({
  // Use the automatic JSX runtime so .tsx (tests + components) don't need a
  // React import, matching Next.js.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    env: {
      // Isolated test DB (see dedicatedTestDbUrl); export writes to a temp file
      // (never GCS).
      DATABASE_URL: dedicatedTestDbUrl(),
      EXPORT_LOCAL_PATH: "/tmp/vitest-redirects.json",
      CONFIG_BUCKET: "test-bucket",
      REDIRECT_STATIC_IP: "34.172.36.60",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**", "src/components/**"],
      reportsDirectory: "./coverage",
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
  },
});
