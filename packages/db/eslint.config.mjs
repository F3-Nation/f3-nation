import baseConfig from "@acme/eslint-config/base";
import drizzleConfig from "@acme/eslint-config/drizzle";

export default [
  { ignores: ["eslint.config.mjs"] },
  ...baseConfig,
  ...drizzleConfig,
  {
    // _reseedUsers/_reseedFromScratch/_deleteSeededData are unreachable —
    // every call site in seed() is commented out; the live local-dev path is
    // local-seed.ts (`pnpm seed:local`). Full-table clears here are dead
    // code, not something this rule needs to guard.
    files: ["src/seed.ts"],
    rules: { "drizzle/enforce-delete-with-where": "off" },
  },
];
