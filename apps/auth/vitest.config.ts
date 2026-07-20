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
        statements: 80,
        branches: 80,
        functions: 90,
        lines: 80,
      },
    },
  },
});
