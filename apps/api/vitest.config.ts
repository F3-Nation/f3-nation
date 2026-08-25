import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    env: { NODE_ENV: "test" },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      // server.ts is a hand-verified process bootstrap (Sentry init, @hono/node-server
      // serve(), SIGTERM handling) — same category as the instrumentation.ts it
      // replaces, which bootstrapCoverageExclude already excludes for every app.
      exclude: [...coverageExclude, "src/server.ts"],
      thresholds: {
        autoUpdate: true,
        statements: 98.95,
        branches: 100,
        functions: 93.75,
        lines: 98.93,
      },
    },
    exclude: [
      "characterization/**", // Runs under vitest.characterization.config.ts
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
});
