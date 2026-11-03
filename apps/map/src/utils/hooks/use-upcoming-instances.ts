"use client";

import { useEffect } from "react";
import { orpc, useQuery } from "~/orpc/react";
import { reportQueryError } from "~/utils/report-query-error";

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
    reportQueryError(error, "map.upcoming_instances.fetch_failed");
  }, [error]);

  return { instances: data, isUnavailable: isError };
}
