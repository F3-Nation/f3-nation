/** @type {import("prettier").Config} */
const config = {
  plugins: [
    // INFO: Enabling this plugin resorts a lot of imports and therefore leads to a lot of file diffs, do in own PR
    // require.resolve("@ianvs/prettier-plugin-sort-imports"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
  tailwindFunctions: ["cn", "cva"],
};

module.exports = config;
