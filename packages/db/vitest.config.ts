import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: { NODE_ENV: "test" },
  },
});
