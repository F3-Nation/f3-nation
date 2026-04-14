import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "__tests__/**/*.test.{ts,tsx}"],
    // F3R5_013: stubs `env()` during unit tests so modules that call
    // `env().options.gcpProjectId` (cert-manager-client) don't crash
    // with EnvValidationError. The env loader tests use `loadEnv(src)`
    // directly and don't depend on `process.env`, so they're unaffected.
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws during unit tests because it's designed to
      // guard against client-bundle imports. We alias it to an empty
      // module so modules that import it can still be exercised.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
