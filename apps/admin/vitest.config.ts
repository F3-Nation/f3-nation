import path from "path";
import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    env: { NODE_ENV: "test", SKIP_ENV_VALIDATION: "1" },
    include: ["src/**/*.test.{ts,tsx}", "__tests__/**/*.test.{ts,tsx}"],
    // v8 coverage merged across parallel worker threads has known
    // nondeterminism for jsdom/React-effect-heavy suites (a branch hit in one
    // worker's report can silently drop during merge) -- this repo's CI has
    // shown a real, reproducible ~1-branch gap vs local runs on the exact
    // same commit while every other metric (statements/functions/lines)
    // matched exactly. Running files sequentially removes the merge step
    // entirely, which is the correct fix for this class of nondeterminism.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 10.03,
        branches: 7.44,
        functions: 5.52,
        lines: 10.23,
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
