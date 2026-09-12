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
        // Browser-only Leaflet map components — require full DOM + Leaflet
        // APIs that aren't available in the Node test environment, so they're
        // excluded from coverage rather than unit-tested.
        "**/org-map.tsx",
        "**/org-map-loader.tsx",
        // Pure TypeScript type declarations — no executable runtime code.
        "**/org/_lib/types.ts",
      ],
      thresholds: {
        autoUpdate: true,
        statements: 88.03,
        branches: 83.18,
        functions: 85.43,
        lines: 89.67,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
