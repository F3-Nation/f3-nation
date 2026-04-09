import baseConfig from "./base.js";

export default [
  ...baseConfig,
  {
    // Plugin config files (react.js, nextjs.js, base.js) use untyped JS plugins
    // that don't have full TypeScript declarations — disable type-safety rules for them
    files: ["*.js"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
];
