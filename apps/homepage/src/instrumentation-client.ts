// Browser error reporting (PostHog error tracking only, no analytics). Runs
// when a page loads; a silent no-op without a key. See
// packages/observability/src/browser.ts and #1223.
// homepage has no env.ts; the key is inlined at build time by
// deploy-homepage.yml.
import { initErrorReporting } from "@acme/observability/browser";

initErrorReporting({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  app: "homepage",
});
