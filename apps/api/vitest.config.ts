import { coverageExclude } from "@acme/vitest-config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true,
    environment: "jsdom",
    env: { NODE_ENV: "test" },
    setupFiles: ["__tests__/setup.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // Exclude bootstrap/config files that aren't unit-testable (Sentry init,
      // Next config, instrumentation, styling config). They otherwise sit in the
      // denominator at 0% and make every edit to them break the global
      // thresholds. Shared list keeps vitest's defaults plus the bootstrap globs.
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 66.48,
        branches: 88.88,
        functions: 50,
        lines: 66.48,
      },
    },
    exclude: [
      "**/tests/**/*.spec.ts", // Exclude Playwright tests
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
