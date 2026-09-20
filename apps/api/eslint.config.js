import baseConfig from "@acme/eslint-config/base";
import drizzleConfig from "@acme/eslint-config/drizzle";
import nextConfig from "@acme/eslint-config/nextjs";
import reactConfig from "@acme/eslint-config/react";
import vitestConfig from "@acme/vitest-config/eslint";

export default [
  ...baseConfig,
  ...drizzleConfig,
  ...nextConfig,
  ...reactConfig,
  ...vitestConfig,
];
