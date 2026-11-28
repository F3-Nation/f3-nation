import { defineConfig } from "vitest/config";

import { coverageExclude, coverageInclude } from "@acme/vitest-config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 62.03,
        branches: 67.83,
        functions: 69.04,
        lines: 61.2,
      },
    },
  },
});
