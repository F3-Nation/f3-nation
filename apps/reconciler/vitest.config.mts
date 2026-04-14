import { defineConfig } from "vitest/config";

// f3-nation does not have a shared vitest preset package; other packages
// (e.g. `packages/api/vitest.config.ts`) each define a standalone config.
// We mirror that pattern here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});

