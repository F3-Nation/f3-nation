/**
 * Browser error reporting for admin, auth, me and homepage: PostHog error
 * tracking only, no product analytics. (The map keeps its own full-analytics
 * setup in apps/map/src/instrumentation-client.ts.)
 *
 * Imported from each app's `instrumentation-client.ts` via
 * `@acme/observability/browser`, a separate entry point so the browser bundle
 * never pulls in the package's node-only OTel pipeline.
 *
 * Cost: these apps share the F3 Monorepo PostHog project with the map. Error
 * tracking has its own free tier (100k exceptions/month), separate from the
 * 1M analytics events the map uses, so everything that would emit an analytics
 * event (autocapture, pageviews, page leaves, web vitals, heatmaps, dead
 * clicks, session recording, surveys) is switched off here. See #1223.
 */
import type { CaptureResult } from "posthog-js";
import posthog from "posthog-js";

export type BrowserEnvironment = "prod" | "staging" | "local" | "dev";

/**
 * One image is built and promoted unchanged from staging to prod, so a
 * build-time channel can't tell them apart; the hostname can. Same
 * vocabulary as the server pipeline's `environment` property.
 */
export function environmentFromHostname(hostname: string): BrowserEnvironment {
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local";
  if (hostname.includes("staging")) return "staging";
  if (hostname === "f3nation.com" || hostname.endsWith(".f3nation.com")) {
    return "prod";
  }
  return "dev";
}

/** Event properties that hold a page URL; posthog-js adds them to every event. */
const URL_PROPERTIES = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
];

/**
 * `url` without its query string and fragment. auth's sign-in pages carry the
 * one-time code and the email there (`/login/email/verify?email=…&code=…`).
 */
function withoutQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * `before_send` hook: strip queries and fragments from every URL property
 * before an event leaves the browser, so a sign-in code can't reach PostHog.
 */
export function scrubUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const key of URL_PROPERTIES) {
      if (key in bag) bag[key] = withoutQuery(bag[key]);
    }
  }
  return event;
}

let enabled = false;

/**
 * Start capturing unhandled exceptions and promise rejections. A silent no-op
 * without a key (local dev, previews, keyless builds). Errors a React error
 * boundary catches are handled, so they never reach this; report those with
 * `captureException`.
 */
export function initErrorReporting(options: {
  key: string | undefined;
  app: "admin" | "auth" | "me" | "homepage";
  hostname?: string;
}): void {
  if (!options.key) return;
  // Runs at module load in each app's instrumentation-client.ts: a PostHog
  // failure must leave reporting off, never break the page.
  try {
    initPostHog(options.key, options.app, options.hostname);
  } catch (initErr) {
    // Same carve-out as captureException below; docs/OBSERVABILITY_PLAN.md §6.
    console.error("posthog.init_failed", initErr);
    return;
  }
  enabled = true;
}

function initPostHog(key: string, app: string, hostname?: string): void {
  posthog.init(key, {
    api_host: "https://us.i.posthog.com",
    capture_exceptions: true,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    // Skip the /flags call on every page load (billed on its own quota). Not
    // advanced_disable_flags, which also skips the remote config that carries
    // PostHog's server-side error-tracking suppression rules.
    advanced_disable_feature_flags: true,
    // Query strings and fragments never leave the browser (see scrubUrls).
    before_send: scrubUrls,
    // No cookies or localStorage: an error-only reporter has no use for a
    // persistent distinct_id, and auth is a sign-in surface.
    persistence: "memory",
  });
  // `app` splits the shared project per app; `environment` splits prod from
  // staging and previews.
  posthog.register({
    app,
    environment: environmentFromHostname(hostname ?? window.location.hostname),
  });
}

/** Report an error a boundary (or other code) caught. No-op when disabled. */
export function captureException(
  error: unknown,
  properties?: Record<string, unknown>,
): void {
  if (!enabled) return;
  // Meant for error boundaries: guards against the SDK ever throwing, so a
  // reporting failure can't escape into the fallback UI.
  try {
    posthog.captureException(error, properties);
  } catch (reportErr) {
    // console.error, not logError: @acme/logger is pino and does not run in
    // the browser. A documented exception to AGENTS.md's no-console rule; see
    // docs/OBSERVABILITY_PLAN.md §6.
    console.error("posthog.capture_exception_failed", reportErr);
  }
}
