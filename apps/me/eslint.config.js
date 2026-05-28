import baseConfig from "@acme/eslint-config/base";
import nextConfig from "@acme/eslint-config/nextjs";
import reactConfig from "@acme/eslint-config/react";

export default [
  {
    ignores: [
      "coverage/**",
      "next-env.d.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
    ],
  },
  ...baseConfig,
  ...nextConfig,
  ...reactConfig,
];
