import baseConfig from "@acme/eslint-config/base";

export default [
  ...baseConfig,
  {
    // createLogger implements the log* helpers by calling the raw pino methods,
    // so the "use the helpers" rule must not apply to this package.
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
