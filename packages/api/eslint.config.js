import baseConfig from "@acme/eslint-config/base";

export default [
  ...baseConfig,
  { ignores: ["vitest.config.ts", "__tests__", "coverage"] },
];
