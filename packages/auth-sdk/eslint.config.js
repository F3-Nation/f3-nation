// @ts-check

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = async () => {
  return [
    {
      ignores: ["dist/", "node_modules/"],
    },
    js.configs.recommended,
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          project: "./tsconfig.json",
          sourceType: "module",
          ecmaVersion: 2021,
        },
      },
      plugins: {
        "@typescript-eslint": tseslint,
      },
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        "@typescript-eslint/explicit-function-return-type": "error",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
        "no-console": "warn",
      },
    },
  ];
};

export default config();
