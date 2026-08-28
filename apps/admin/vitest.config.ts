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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        // A small buffer below the exact figure a local `pnpm test` run
        // reports (~8.94/6.09/3.99/9.16 as of this change): CI's
        // coverage count fluctuates by a few hundredths of a percent run to
        // run (worker-thread scheduling jitter in code with
        // timing-dependent branches, not a real coverage regression) and
        // pinning the exact local figure flaked CI once already on this PR
        // (see the PR conversation). autoUpdate still ratchets these up as
        // real coverage improves.
        statements: 8.84,
        branches: 5.94,
        functions: 3.89,
        lines: 9.06,
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
