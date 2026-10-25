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
        statements: 98.98,
        branches: 99.32,
        functions: 97.82,
        lines: 98.82,
      },
    },
  },
});
