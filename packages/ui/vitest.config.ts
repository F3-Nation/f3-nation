import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // Scoped to the shared route-boundary bodies: the rest of the UI kit is
      // shadcn-derived and untested, and putting it in the denominator would
      // make every unrelated edit move the autoUpdate thresholds.
      include: ["src/route-*.tsx"],
      thresholds: {
        autoUpdate: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
