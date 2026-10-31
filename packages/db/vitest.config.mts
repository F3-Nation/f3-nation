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
        statements: 57.55,
        branches: 63.63,
        functions: 60.09,
        lines: 56.55,
      },
    },
  },
});
