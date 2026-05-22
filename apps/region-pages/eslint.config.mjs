import baseConfig from '@acme/eslint-config/base';
import nextConfig from '@acme/eslint-config/nextjs';
import reactConfig from '@acme/eslint-config/react';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.next/**',
      'drizzle/**',
      'scripts/**',
      'public/**',
      '*.config.{js,mjs,ts}',
    ],
  },
  ...baseConfig,
  ...nextConfig,
  ...reactConfig,
  {
    // First-pass monorepo migration: downgrade the strictest type-aware rules to
    // warnings so the lift-and-shift lands without behavior-risky mass edits
    // (e.g. `||`->`??`). TODO(region-pages): tighten these back to errors.
    rules: {
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
    },
  },
];
