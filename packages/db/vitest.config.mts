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
        statements: 26.98,
        branches: 30.27,
        functions: 35.07,
        lines: 26.85,
      },
    },
  },
});
