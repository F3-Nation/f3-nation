import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // DB-backed tests share one Postgres test database; run files serially so
    // they don't race on the same rows.
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
