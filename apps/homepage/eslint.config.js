import baseConfig from "@acme/eslint-config/base";
import nextConfig from "@acme/eslint-config/nextjs";
import reactConfig from "@acme/eslint-config/react";
import tailwindConfig from "@acme/eslint-config/tailwind";
import vitestConfig from "@acme/vitest-config/eslint";

export default [
  {
    ignores: ["coverage/**", "next-env.d.ts", ".next/**", "out/**"],
  },
  ...baseConfig,
  ...nextConfig,
  ...reactConfig,
  ...tailwindConfig({ entryPoint: "src/app/globals.css" }),
  ...vitestConfig,
];
