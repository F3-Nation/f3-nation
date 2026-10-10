import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/fixtures/**"],
      thresholds: {
        autoUpdate: true,
        statements: 82.92,
        branches: 70.37,
        functions: 50,
        lines: 82.5,
      },
    },
  },
});
