import turboConfig from "eslint-config-turbo/flat";
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
  ...turboConfig,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: { project: true },
    },
    settings: {
      "import-x/extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      "import-x/resolver": {
        node: { extensions: [".ts", ".tsx", ".js", ".jsx"] },
      },
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
      "import/no-cycle": "error",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
      // Steer event logging through the @acme/logger helpers (logDebug, logInfo,
      // …), which keep the event-first signature and the error-reporter fan-out.
      // The raw pino instance is reserved for `logger.child()`.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='logger'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/]",
          message:
            "Use the log* helpers (logDebug/logInfo/logError/…) instead of the raw pino logger. Reserve `logger` for `logger.child()`.",
        },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
);
