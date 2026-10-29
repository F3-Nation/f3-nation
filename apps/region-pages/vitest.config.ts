import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: { NODE_ENV: "test", SKIP_ENV_VALIDATION: "1" },
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: [
        ...coverageExclude,
        // Declarative Next.js shells and config with no logic to test; at 0%
        // they only add noise to the percentage.
        "src/app/layout.tsx",
        "src/app/error.tsx",
        "src/app/not-found.tsx",
        "src/app/robots.ts",
        "src/env.ts",
        "src/lib/logging.ts",
        "src/components/svgs/**",
      ],
      thresholds: {
        autoUpdate: true,
        statements: 70.8,
        branches: 58.12,
        functions: 71.09,
        lines: 70.09,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
