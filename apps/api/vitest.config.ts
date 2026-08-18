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
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 98.18,
        branches: 100,
        functions: 87.5,
        lines: 98.18,
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
