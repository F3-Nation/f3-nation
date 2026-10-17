import { coverageExclude, coverageInclude } from "@acme/vitest-config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // jwt.ts imports ~/env; without this the tsconfig `~/*` path does not resolve.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        autoUpdate: true,
        statements: 74.45,
        branches: 70.72,
        functions: 79.35,
        lines: 75,
      },
    },
  },
});
