// Browser error reporting (PostHog error tracking only, no analytics). Runs
// when a page loads; a silent no-op without a key. See
// packages/observability/src/browser.ts and #1223.
// Reads process.env directly, not ~/env: in the browser, importing ~/env
// validates the whole client schema, and values the image doesn't bake in at
// build time would make it throw on every page. Next inlines this reference at
// build time.
import { initErrorReporting } from "@acme/observability/browser";

initErrorReporting({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  app: "auth",
});
