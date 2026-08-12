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
        statements: 18.82,
        branches: 16.51,
        functions: 13.78,
        lines: 19.32,
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
