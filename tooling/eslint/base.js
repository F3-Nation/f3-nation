import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

/** @type {import("typescript-eslint").Config} */
export default tseslint.config(
  {
    ignores: [
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.config.ts",
      ".next",
      "dist",
      "pnpm-lock.yaml",
      "**/next-env.d.ts",
    ],
  },
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: { project: true },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-misused-promises": [
        2,
        { checksVoidReturn: { attributes: false } },
      ],
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
