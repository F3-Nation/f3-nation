import { coverageExclude, coverageInclude } from "@acme/vitest-config";
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
      // Measure all of src (Vitest 4 otherwise only counts imported files), minus
      // non-testable bootstrap/config files (defensive; map uses static thresholds,
      // so this only keeps the denominator consistent with other apps).
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: false,
        statements: 1.8,
        // Vitest 4's AST-aware v8 remapping counts branches/functions more
        // granularly, so whole-src branch/function coverage measures lower than
        // under v3. Floors lowered to sit just under the v4 baseline (branches
        // ~4.4%, functions ~7.7%) while still guarding against regressions.
        branches: 4,
        functions: 7,
        lines: 1.8,
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
