import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
