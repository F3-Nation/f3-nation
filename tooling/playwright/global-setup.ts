/**
 * Fail-fast environment validation, run by Playwright before any test.
 *
 * This lives in globalSetup rather than at config-load time so that static
 * analysis tools (knip, typecheck, IDE tooling) can load
 * apps/<app>/playwright.config.ts without E2E env vars set — only an actual
 * test run requires them.
 */
export default function globalSetup(): void {
  if (!process.env.E2E_BASE_URL) {
    throw new Error(
      "E2E_BASE_URL is required but not set. Point it at the deployment " +
        "under test, e.g. " +
        "E2E_BASE_URL=https://pr-123-map-<project>.us-central1.run.app " +
        "pnpm test:e2e",
    );
  }
}
