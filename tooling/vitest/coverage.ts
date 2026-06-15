import { coverageConfigDefaults } from "vitest/config";

/**
 * Bootstrap/config/instrumentation files that aren't unit-testable (Sentry init,
 * Next config, instrumentation, styling config, middleware). They otherwise sit in
 * the coverage denominator at 0%, so every edit to them breaks autoUpdate thresholds.
 * Generalized globs cover filename variants across apps (next.config.ts vs .js,
 * postcss.config.mjs vs .cjs).
 */
export const bootstrapCoverageExclude = [
  "**/sentry.*.config.ts",
  "**/next.config.{js,ts,mjs}",
  "**/instrumentation.ts",
  "**/instrumentation-client.ts",
  "**/tailwind.config.ts",
  "**/postcss.config.{cjs,mjs}",
  "**/middleware.ts",
];

/**
 * Vitest's built-in excludes (node_modules, test files, type declarations, ...)
 * combined with the non-testable bootstrap files above. Spread into each app's
 * `coverage.exclude` so the configs can't drift.
 */
export const coverageExclude = [
  ...coverageConfigDefaults.exclude,
  ...bootstrapCoverageExclude,
];
