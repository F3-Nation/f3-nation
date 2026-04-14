import { defineConfig } from "vitest/config";

// Mirrors the standalone per-package vitest configs elsewhere in the
// monorepo (e.g. `apps/reconciler/vitest.config.mts`, `packages/api/vitest.config.ts`).
// The runtime has no React components — everything tested here is pure
// TypeScript, so `environment: "node"` is correct.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    coverage: {
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/db-client.ts"],
    },
  },
});
