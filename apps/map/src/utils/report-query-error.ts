import posthog from "posthog-js";

import { env } from "~/env";

/**
 * Reported once per error object rather than once per subscriber: every caller
 * of a query shares a single cache entry, so they all observe the same `Error`
 * instance.
 */
const reportedErrors = new WeakSet<object>();

/**
 * Captures the error of a query that opts out of the app-wide `throwOnError`
 * (see `~/orpc/query-client`). Skipping the throw also skips `global-error.tsx`,
 * which is where the exception would otherwise be captured, so the caller
 * reports it here. Call it from an effect, with a stable `event` name so triage
 * queries carry over.
 */
export function reportQueryError(
  error: Error | null | undefined,
  event: string,
): void {
  if (!error || reportedErrors.has(error)) return;
  reportedErrors.add(error);
  // Gate on the env flag — the same stable signal instrumentation-client.ts
  // uses to decide whether to init posthog-js at all.
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  // A query that opts out of the throw exists so its failure can't take down
  // the map. A throw from captureException itself — ingest host blocked by an
  // ad-blocker or privacy list — would do exactly that, from inside an
  // effect, turning a degraded decoration into a broken page. Same reasoning
  // and same shape as global-error.tsx's guard.
  try {
    // PostHog takes flat properties rather than Sentry's `tags` bag.
    posthog.captureException(error, { event });
  } catch {
    // Swallowed deliberately, and without a console.error: unlike the
    // reporter's own failure paths (docs/OBSERVABILITY_PLAN.md §6), this is
    // ordinary app code with a working logger available — but it runs in the
    // browser where @acme/logger (pino) does not. Dropping one decoration's
    // error report is the right trade against breaking the map.
  }
}
