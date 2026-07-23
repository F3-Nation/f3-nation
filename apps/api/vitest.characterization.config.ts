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
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // Serialized because every file shares one f3_test database; fixture inserts
    // in parallel files would interleave. (isolate: true already gives each file
    // a fresh module registry, so per-file module state is not the reason.)
    fileParallelism: false,
    // Load-bearing: under NODE_ENV=development, getSession returns a full admin
    // getDevMockSession() for any unauthenticated request (shared.ts), which
    // would make every auth characterization vacuous.
    env: { NODE_ENV: "test" },
    include: ["characterization/**/*.char.test.ts"],
    globalSetup: ["./characterization/global-setup.ts"],
    // Vite must transform these for the aliases above to apply.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    // No coverage block: this suite characterizes behavior, it does not chase a
    // coverage number. apps/api's thresholds live in vitest.config.ts.
  },
});
