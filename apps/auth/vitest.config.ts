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
        statements: 86.95,
        branches: 72.72,
        functions: 100,
        lines: 86.95,
      },
    },
  },
});
