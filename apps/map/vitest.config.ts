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
        // The OTel rework moved posthog-server.ts out of this app into
        // @acme/observability, then brought instrumentation.ts and
        // instrumentation-client.ts back into the denominator with tests of
        // their own (see tooling/vitest/coverage.ts) — net upward.
        autoUpdate: true,
        statements: 28.73,
        branches: 27.66,
        functions: 22.82,
        lines: 28.73,
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
    alias: {
      // Mock server-only modules in test environment
      "server-only": new URL(
        "./__tests__/mocks/server-only.ts",
        import.meta.url,
      ).pathname,
      // Mock oRPC server client to avoid database initialization
      "~/orpc/client.server": new URL(
        "./__tests__/mocks/orpc-client-server.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
