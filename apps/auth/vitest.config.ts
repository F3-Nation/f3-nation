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
        statements: 48.81,
        branches: 46.76,
        functions: 54.05,
        lines: 48.24,
      },
    },
  },
});
