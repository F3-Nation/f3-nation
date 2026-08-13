import baseConfig from "@acme/eslint-config/base";
import drizzleConfig from "@acme/eslint-config/drizzle";

export default [
  { ignores: ["eslint.config.mjs"] },
  ...baseConfig,
  ...drizzleConfig,
];
