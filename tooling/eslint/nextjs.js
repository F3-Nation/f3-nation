import nextPlugin from "@next/eslint-plugin-next";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
      "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
      "@typescript-eslint/require-await": "off",
    },
  },
];
