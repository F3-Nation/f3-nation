import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // jwt.ts imports ~/env; without this the tsconfig `~/*` path does not resolve.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        // Lowered from the prior commit's floor after removing the OAuth-
        // client admin API routes (and their tests) — that surface is
        // moving to its own follow-up PR. autoUpdate only ever raises these
        // floors on a run with higher coverage, never lowers them, so this
        // manual drop reflects the actual, deliberate removal of tested
        // code rather than a suite regression.
        statements: 46.49,
        branches: 44.52,
        functions: 52.7,
        lines: 46.14,
      },
    },
  },
});
