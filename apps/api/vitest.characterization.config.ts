import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    // Serialized because every file shares one f3_test database; fixture inserts
    // in parallel files would interleave. (isolate: true already gives each file
    // a fresh module registry, so per-file module state is not the reason.)
    fileParallelism: false,
    // isolate: true makes every file re-import the app module (router,
    // DB pool) on its first request through the seam, so each file's
    // first test pays a full cold start against the 5s default.
    testTimeout: 20_000,
    // Load-bearing: under NODE_ENV=development, getSession() (shared.ts) returns
    // getDevMockSession() — an authenticated but role-LESS session — for any
    // request with no session and no bearer token, instead of null. That makes
    // every "unauthenticated -> 401" case on a protectedProcedure vacuous
    // (admin/editor cases still reject the role-less session). NODE_ENV=test
    // disables it.
    env: { NODE_ENV: "test" },
    include: ["characterization/**/*.char.test.ts"],
    globalSetup: ["./characterization/global-setup.ts"],
    // next-auth's ESM graph imports `next/server` without the `.js` extension,
    // which plain Node resolution rejects; Vite has to transform it.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    // No coverage block: this suite characterizes behavior, it does not chase a
    // coverage number. apps/api's thresholds live in vitest.config.ts.
  },
});
