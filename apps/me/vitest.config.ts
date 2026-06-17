import { coverageExclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: { NODE_ENV: "test" },
    include: ["src/**/*.test.{ts,tsx}", "__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // Exclude non-testable bootstrap/config files so they don't sit in the
      // coverage denominator at 0% and break the autoUpdate thresholds on edit.
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 26.08,
        branches: 82.89,
        functions: 48.61,
        lines: 26.08,
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
