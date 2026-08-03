import { defineConfig } from "vitest/config";

import { coverageInclude } from "@acme/vitest-config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      include: coverageInclude,
    },
  },
});
