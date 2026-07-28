import { fileURLToPath } from "url";
import type { PlaywrightTestConfig } from "@playwright/test";
import { defineConfig, devices } from "@playwright/test";

/**
 * Shared base config for the two-tier E2E model (see docs/E2E_TIERS.md):
 *
 *   - `blocking` project — `tests/e2e/`          — red means no merge.
 *   - `advisory` project — `tests/e2e-advisory/` — runs and reports, never
 *     blocks; failures are triage input.
 *
 * Each tier is a Playwright project selected with `--project=<tier>`, so
 * `test:e2e` / `test:e2e:advisory` scripts stay a one-flag difference and
 * `playwright test --list` shows both tiers grouped by project.
 *
 * The suites run against a deployed target (per-PR preview environments in
 * CI) or a locally running stack, so `E2E_BASE_URL` is required to RUN tests —
 * but the requirement is enforced in global-setup.ts, not here, so static
 * analysis tools (knip, typecheck) can load an app's playwright.config.ts
 * without E2E env vars set. Preview environments scale to zero, which means
 * the first navigation may sit through a Cloud Run cold start (~10s); the
 * timeouts below are sized for that.
 *
 * Usage (apps/<app>/playwright.config.ts):
 *
 *   import { createBaseConfig } from "@acme/playwright-config";
 *   export default createBaseConfig();
 *
 * Pass overrides to tweak per app, e.g. `createBaseConfig({ workers: 2 })`.
 */
export function createBaseConfig(
  overrides: PlaywrightTestConfig = {},
): PlaywrightTestConfig {
  return defineConfig(
    {
      // Fails fast when E2E_BASE_URL is unset — deferred to setup time so
      // loading this config never requires the env var.
      globalSetup: fileURLToPath(new URL("./global-setup.ts", import.meta.url)),
      // Cold-starting scale-to-zero target: allow generous per-test budget.
      timeout: 90_000,
      expect: { timeout: 15_000 },
      retries: process.env.CI ? 1 : 0,
      // Single worker by default — the preview env runs max 1 instance and
      // the suites share app state (map viewport, panels). Override per app
      // if a suite is safe to parallelize.
      workers: 1,
      forbidOnly: !!process.env.CI,
      reporter: [["list"], ["html", { open: "never" }]],
      use: {
        baseURL: process.env.E2E_BASE_URL,
        trace: "retain-on-failure",
        video: "retain-on-failure",
        screenshot: "only-on-failure",
        actionTimeout: 15_000,
        // First navigation may include a Cloud Run cold start.
        navigationTimeout: 45_000,
      },
      // One project per tier; directory convention decides the tier a spec
      // belongs to. Chromium only for now; add firefox/webkit variants when
      // the suites are stable enough to be worth the CI minutes.
      projects: [
        {
          name: "blocking",
          testMatch: "**/tests/e2e/**/*.spec.ts",
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "advisory",
          testMatch: "**/tests/e2e-advisory/**/*.spec.ts",
          use: { ...devices["Desktop Chrome"] },
        },
      ],
    },
    overrides,
  );
}
