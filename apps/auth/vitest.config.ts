import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/phone.ts"],
      thresholds: {
        autoUpdate: true,
        statements: 91.66,
        branches: 80,
        functions: 100,
        lines: 90.9,
      },
    },
  },
});
