import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    env: { NODE_ENV: "test" },
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: [
        ...coverageExclude,
        // Browser-only Leaflet map component — requires full DOM + Leaflet APIs,
        // not testable in Node. Covered by E2E tests instead.
        "**/org-map.tsx",
        "**/org-map-loader.tsx",
      ],
      thresholds: {
        autoUpdate: true,
        statements: 75.07,
        branches: 74.23,
        functions: 66.66,
        lines: 76,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
