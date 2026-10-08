import baseConfig from "@acme/eslint-config/base";
import drizzleConfig from "@acme/eslint-config/drizzle";
import vitestConfig from "@acme/vitest-config/eslint";

export default [
  { ignores: ["eslint.config.mjs", "vitest.config.mts"] },
  ...baseConfig,
  ...drizzleConfig,
  ...vitestConfig,
];
