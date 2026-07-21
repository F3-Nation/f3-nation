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
      include: [
        "src/lib/phone.ts",
        "src/lib/oauth.ts",
        "src/app/api/oauth/token/route.ts",
      ],
      thresholds: {
        statements: 99.39,
        branches: 91.66,
        functions: 100,
        lines: 99.35,
      },
    },
  },
});
