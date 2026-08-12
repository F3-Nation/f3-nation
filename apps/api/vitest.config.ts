import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "jsdom",
    env: { NODE_ENV: "test" },
    setupFiles: ["__tests__/setup.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        // Lowered when the OTel rework moved posthog-server.ts (fully
        // covered) out of this app into @acme/observability — the remaining
        // src denominator has proportionally more uncovered bootstrap code.
        autoUpdate: true,
        statements: 91.42,
        branches: 93.75,
        functions: 80,
        lines: 91.42,
      },
    },
    exclude: [
      "characterization/**", // Runs under vitest.characterization.config.ts
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    server: {
      deps: {
        inline: ["vitest-canvas-mock", "jest-canvas-mock"],
      },
    },
  },
});
