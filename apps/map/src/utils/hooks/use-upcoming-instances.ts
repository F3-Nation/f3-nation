"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import { env } from "~/env";
import { orpc, useQuery } from "~/orpc/react";

/**
 * Reported once per error object rather than once per subscriber: every caller
 * shares a single cache entry, so they all observe the same `Error` instance.
 */
const reportedErrors = new WeakSet<object>();

/**
 * The next 30 days of schedule exceptions — closures, time changes, one-off
 * relocations — shared by every surface that flags them.
 *
 * Opts out of the app-wide `throwOnError` (see `~/orpc/query-client`) so a
 * failure decorating the map can't replace it with the global error page. Two
 * consequences: a failed fetch looks just like "nothing has changed", so
 * callers must surface `isUnavailable`; and since skipping the throw also
 * skips `global-error.tsx`, the exception capture happens here.
 */
export function useUpcomingInstances({ enabled }: { enabled?: boolean } = {}) {
  const { data, isError, error } = useQuery(
    orpc.map.location.upcomingInstances.queryOptions({
      input: undefined,
      throwOnError: false,
      enabled,
    }),
  );

  useEffect(() => {
    if (!error || reportedErrors.has(error)) return;
    reportedErrors.add(error);
    // Gate on the env flag — the same stable signal instrumentation-client.ts
    // uses to decide whether to init posthog-js at all.
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
    // This hook's whole reason for existing is that a failed fetch here must
    // NOT take down the map (it opts out of the app-wide throwOnError). A
    // throw from captureException itself — ingest host blocked by an
    // ad-blocker or privacy list — would do exactly that, from inside an
    // effect, turning a degraded decoration into a broken page. Same
    // reasoning and same shape as global-error.tsx's guard.
    try {
      // PostHog takes flat properties rather than Sentry's `tags` bag; keep
      // the same `event` name so existing triage queries carry over.
      posthog.captureException(error, {
        event: "map.upcoming_instances.fetch_failed",
      });
    } catch {
      // Swallowed deliberately, and without a console.error: unlike the
      // reporter's own failure paths (docs/OBSERVABILITY_PLAN.md §6), this is
      // ordinary app code with a working logger available — but it runs in the
      // browser where @acme/logger (pino) does not. Dropping one decoration's
      // error report is the right trade against breaking the map.
    }
  }, [error]);

  return { instances: data, isUnavailable: isError };
}
