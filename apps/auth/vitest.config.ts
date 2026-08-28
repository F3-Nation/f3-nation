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
        statements: 48.8,
        branches: 48.74,
        functions: 53.16,
        lines: 48.49,
      },
    },
  },
});
