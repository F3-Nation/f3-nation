import baseConfig from "@acme/eslint-config/base";
import nextConfig from "@acme/eslint-config/nextjs";
import reactConfig from "@acme/eslint-config/react";

export default [
  ...baseConfig,
  ...nextConfig,
  ...reactConfig,
  { ignores: ["next-env.d.ts"] },
];
