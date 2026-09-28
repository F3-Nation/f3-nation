import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        autoUpdate: true,
        statements: 97.59,
        branches: 96.29,
        functions: 96.66,
        lines: 97.22,
      },
    },
  },
});
