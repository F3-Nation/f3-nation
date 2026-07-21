import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/phone.ts", "src/lib/oauth.ts"],
      thresholds: {
        autoUpdate: true,
        statements: 99.18,
        branches: 89.18,
        functions: 100,
        lines: 99.09,
      },
    },
  },
});
