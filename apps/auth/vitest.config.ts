import { defineConfig } from "vitest/config";

export default defineConfig({
  // jwt.ts imports ~/env; without this the tsconfig `~/*` path does not resolve.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/phone.ts", "src/lib/jwt.ts"],
      thresholds: {
        autoUpdate: true,
        statements: 96.29,
        branches: 85.71,
        functions: 100,
        lines: 96.15,
      },
    },
  },
});
