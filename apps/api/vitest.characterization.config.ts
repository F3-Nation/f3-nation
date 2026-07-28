import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const nextHeadersShim = fileURLToPath(
  new URL("./characterization/next-headers-shim.ts", import.meta.url),
);
const nextCacheShim = fileURLToPath(
  new URL("./characterization/next-cache-shim.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // `vi.mock` cannot reach next-auth's own `next/headers` import, so the
      // shim is wired in by alias instead. Requires the deps.inline below.
      { find: /^next\/headers$/, replacement: nextHeadersShim },
      // Same reason: revalidatePath() is a post-auth side effect that throws
      // outside a Next request scope, and vi.mock cannot reach it either.
      { find: /^next\/cache$/, replacement: nextCacheShim },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // Serialized because every file shares one f3_test database; fixture inserts
    // in parallel files would interleave. (isolate: true already gives each file
    // a fresh module registry, so per-file module state is not the reason.)
    fileParallelism: false,
    // Load-bearing: under NODE_ENV=development, getSession() (shared.ts) returns
    // getDevMockSession() — an authenticated but role-LESS session — for any
    // request with no session and no bearer token, instead of null. That makes
    // every "unauthenticated -> 401" case on a protectedProcedure vacuous
    // (admin/editor cases still reject the role-less session). NODE_ENV=test
    // disables it.
    env: { NODE_ENV: "test" },
    include: ["characterization/**/*.char.test.ts"],
    globalSetup: ["./characterization/global-setup.ts"],
    // Vite must transform these for the aliases above to apply.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    // No coverage block: this suite characterizes behavior, it does not chase a
    // coverage number. apps/api's thresholds live in vitest.config.ts.
  },
});
