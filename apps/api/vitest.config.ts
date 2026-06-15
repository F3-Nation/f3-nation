import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

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
      // thresholds. Keep vitest's defaults (node_modules, test files, etc.).
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/sentry.*.config.ts",
        "**/next.config.js",
        "**/instrumentation.ts",
        "**/instrumentation-client.ts",
        "**/tailwind.config.ts",
        "**/postcss.config.cjs",
        "**/middleware.ts",
      ],
      thresholds: {
        autoUpdate: true,
        statements: 65.41,
        branches: 88.88,
        functions: 50,
        lines: 65.41,
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
