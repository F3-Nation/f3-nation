import posthog from "posthog-js";

import { env } from "~/env";

export function reportClientError(error: unknown) {
  // Gate on the env flag (the same stable signal instrumentation-client.ts
  // uses to decide whether to init), not posthog.__loaded — that's an
  // internal SDK flag, not a documented readiness contract, and can be
  // false/undefined during early app startup, dropping early error reports.
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  // Callers are error boundaries, the last stop for this error. If
  // captureException itself throws (e.g. the ingest host is blocked by an
  // ad-blocker/privacy list), the throw must not escape.
  try {
    posthog.captureException(error);
  } catch (reportErr) {
    // console.error, not logError: @acme/logger is pino and does not run
    // in the browser, so there is no approved alternative here. Swallowing
    // instead would make a blocked or failing ingest host look identical
    // to "no errors occurred". A documented exception to AGENTS.md's
    // no-console rule — see docs/OBSERVABILITY_PLAN.md §6.
    console.error("posthog.capture_exception_failed", reportErr);
  }
}
