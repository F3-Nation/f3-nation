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
        statements: 25.52,
        branches: 27.25,
        functions: 34.81,
        lines: 25.21,
      },
    },
  },
});
