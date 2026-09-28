import { coverageConfigDefaults } from "vitest/config";

/**
 * Bootstrap/config/instrumentation files that aren't unit-testable (Next
 * config, instrumentation, styling config, middleware). They otherwise sit in
 * the coverage denominator at 0%, so every edit to them breaks autoUpdate
 * thresholds. Generalized globs cover filename variants across apps
 * (next.config.ts vs .js, postcss.config.mjs vs .cjs).
 *
 * instrumentation.ts / instrumentation-client.ts are deliberately NOT listed
 * here. They were, as init boilerplate, but they carry real decisions worth
 * pinning: the Node-runtime guard, reporter registration, `onRequestError`
 * reporting the static route template rather than the resolved path (a PII
 * rule), and the client's masking + environment-tagging posture. Only map and
 * api have these files and both are now covered — see
 * `apps/{api,map}/__tests__/instrumentation.test.ts` and
 * `apps/map/__tests__/instrumentation-client.test.ts`.
 */
export const bootstrapCoverageExclude = [
  "**/next.config.{js,ts,mjs}",
  "**/tailwind.config.{js,ts,cjs,mjs}",
  "**/postcss.config.{js,ts,cjs,mjs}",
  "**/middleware.{js,ts}",
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

/**
 * Whole-`src` coverage measurement. Vitest 4's v8 provider removed `coverage.all`
 * and only measures files a test actually imports unless `coverage.include` is set.
 * Setting this explicitly preserves v3's behaviour — untested files stay in the
 * denominator — so coverage keeps answering "how much of the app is tested" rather
 * than "how much of what we imported is tested". Pair with `coverageExclude`.
 */
export const coverageInclude = ["src/**/*.{ts,tsx}"];
