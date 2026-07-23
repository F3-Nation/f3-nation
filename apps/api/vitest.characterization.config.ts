import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const nextHeadersShim = fileURLToPath(
  new URL("./characterization/next-headers-shim.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // `vi.mock` cannot reach next-auth's own `next/headers` import, so the
      // shim is wired in by alias instead. Requires the deps.inline below.
      { find: /^next\/headers$/, replacement: nextHeadersShim },
      // next-auth/lib/env.js imports the bare `next/server` specifier, which
      // Vite cannot resolve. Point at the real file — NOT a mock — so genuine
      // NextResponse stays in play.
      { find: /^next\/server$/, replacement: "next/server.js" },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // The rate limiter and the JWKS module cache are per-worker singletons.
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    include: ["characterization/**/*.char.test.ts"],
    globalSetup: ["./characterization/global-setup.ts"],
    // Vite must transform these for the aliases above to apply.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    // No coverage block: this suite characterizes behavior, it does not chase a
    // coverage number. apps/api's thresholds live in vitest.config.ts.
  },
});
