import baseConfig from "@acme/eslint-config/base";
import reactConfig from "@acme/eslint-config/react";
import tailwindConfig from "@acme/eslint-config/tailwind";

export default [
  ...baseConfig,
  ...reactConfig,
  ...tailwindConfig({
    entryPoint: "node_modules/@acme/tailwind-config/web.css",
  }),
];
