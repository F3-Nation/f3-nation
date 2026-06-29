const path = require("path");

/** @type {import("prettier").Config} */
const config = {
  plugins: [
    // INFO: Enabling this plugin resorts a lot of imports and therefore leads to a lot of file diffs, do in own PR
    // require.resolve("@ianvs/prettier-plugin-sort-imports"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
  tailwindFunctions: ["cn", "cva"],
  // Tailwind v4 has no JS config; the plugin needs the CSS entry point to resolve
  // the design system (theme tokens, custom utilities) for class sorting. Point it
  // at the shared stylesheet via an absolute path so it resolves regardless of the
  // package prettier runs from.
  tailwindStylesheet: path.resolve(__dirname, "../tailwind/web.css"),
};

module.exports = config;
