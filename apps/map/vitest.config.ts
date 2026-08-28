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
        autoUpdate: true,
        // Small buffer below the exact local `pnpm test` figure
        // (19.19/16.87/13.57/19.59) -- see apps/admin/vitest.config.ts for
        // why (CI's coverage count has a few hundredths of a percent of
        // run-to-run jitter; this app's own committed threshold flaked once
        // already on this PR at a razor-thin margin).
        statements: 19.05,
        branches: 16.72,
        functions: 13.42,
        lines: 19.44,
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
