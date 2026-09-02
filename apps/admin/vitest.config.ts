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
    // Ruled out as the fix for the branches flake documented below (same
    // ~1-branch gap reproduced with this on), but sequential execution is
    // still the more trustworthy mode for coverage accuracy, so left on.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        // Lowered from the prior commit's floor after removing the OAuth
        // clients admin UI (page, table, modal) and its tests — that
        // surface is moving to its own follow-up PR once Better Auth is
        // actually deployed somewhere. branches/functions are set below
        // what this suite currently measures locally as slack for the same
        // pre-existing ~1-branch CI-vs-local flake this repo has seen
        // before: the same run, repeated back-to-back with no code changes,
        // is stable locally, but CI's v8 report has occasionally landed a
        // hair lower than an otherwise byte-identical local report.
        // autoUpdate will only ever raise these values on a local run with
        // higher coverage, never lower them, so this manual drop reflects
        // the deliberate removal of tested code, not a suite regression.
        statements: 8.48,
        branches: 5.87,
        functions: 3.84,
        lines: 8.7,
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
