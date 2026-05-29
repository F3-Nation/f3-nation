import baseConfig from "@acme/eslint-config/base";
import nextConfig from "@acme/eslint-config/nextjs";
import reactConfig from "@acme/eslint-config/react";

export default [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "next-env.d.ts",
      "**/*.config.ts",
      "**/*.config.js",
      "eslint.config.js",
      "e2e/**",
      "scripts/**",
    ],
  },
  ...baseConfig,
  ...nextConfig,
  ...reactConfig,
  {
    // Tests use mocked fetch / res.json() which are intentionally loosely
    // typed; the type-aware "unsafe" rules add noise without value here.
    files: ["**/*.test.ts", "**/*.test.tsx", "src/test-setup.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // The jest-dom matcher augmentation is intentionally an empty interface.
    files: ["src/vitest.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
];
