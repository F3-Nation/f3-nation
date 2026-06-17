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
        statements: 27.33,
        branches: 82.6,
        functions: 49.29,
        lines: 27.33,
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
