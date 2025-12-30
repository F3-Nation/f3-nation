/** @typedef {import("prettier").Config} PrettierConfig */

/** @type { PrettierConfig } */
const config = {
  // arrowParens: "always",
  // printWidth: 80,
  // singleQuote: true,
  // jsxSingleQuote: true,
  // semi: false,
  // trailingComma: "all",
  // tabWidth: 2,
  // Plugins temporarily disabled for CI compatibility testing
  // plugins: [
  //   "@ianvs/prettier-plugin-sort-imports",
  //   "prettier-plugin-tailwindcss",
  // ],
  // tailwindFunctions: ["cn", "cva"],
  // importOrder: [
  //   "<TYPES>",
  //   "^(react/(.*)$)|^(react$)|^(react-native(.*)$)",
  //   "^(next/(.*)$)|^(next$)",
  //   "^(expo(.*)$)|^(expo$)",
  //   "<THIRD_PARTY_MODULES>",
  //   "",
  //   "<TYPES>^@acme",
  //   "^@acme/(.*)$",
  //   "",
  //   "<TYPES>^[.|..|~]",
  //   "^~/",
  //   "^[../]",
  //   "^[./]",
  // ],
  // importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],
  // importOrderTypeScriptVersion: "5.3.3",
};

module.exports = config;
