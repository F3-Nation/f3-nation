"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Query, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";
import { retryDelayMs } from "@acme/ui/api-unavailable";
import { Button } from "@acme/ui/button";

/** A query that is on screen and last failed because the API is down. */
const isFailedByOutage = (query: Query) =>
  query.state.status === "error" && isApiUnavailableError(query.state.error);

// Refetching a query that has no data resets it to `pending` and clears its
// error, so the banner would vanish for every retry. Remember which queries
// failed by outage to keep the banner up until they actually succeed.
const outageQueries = new WeakSet<Query>();

function isInOutage(query: Query): boolean {
  if (isFailedByOutage(query)) {
    outageQueries.add(query);
    return true;
  }
  if (query.state.status === "pending" && outageQueries.has(query)) {
    return true;
  }
  outageQueries.delete(query);
  return false;
}

function hasApiOutage(queryClient: QueryClient): boolean {
  return (
    queryClient
      .getQueryCache()
      .findAll({ type: "active", predicate: isInOutage }).length > 0
  );
}

function retryFailedQueries(queryClient: QueryClient) {
  return queryClient.refetchQueries(
    { type: "active", predicate: isFailedByOutage },
    // Join a fetch already in flight instead of aborting and restarting it.
    { cancelRefetch: false },
  );
}

/**
 * Tells the user the F3 Nation API is not responding and retries on its own.
 *
 * It sits over the map rather than replacing it: the Google map and any data
 * already loaded keep working, and the data fills in once the API recovers.
 * The outage is read off the query cache, so every query (not only the map
 * datasets) feeds it without each caller handling the error.
 *
 * It refetches the failed active queries instead of calling
 * `window.location.reload()` (as the me and admin outage screens do): a reload
 * would re-download the ~1.5 MB map datasets that are already on screen.
 */
export function ApiOutageBanner() {
  const queryClient = useQueryClient();
  const outage = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => hasApiOutage(queryClient),
    () => false,
  );

  useEffect(() => {
    if (!outage) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        // A background tab has no one waiting on it; check again later
        // instead of adding load to an API that is already struggling.
        if (document.visibilityState === "visible") {
          void retryFailedQueries(queryClient);
        }
        schedule();
      }, retryDelayMs());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [outage, queryClient]);

  if (!outage) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-2">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md flex-col gap-2 rounded-lg border bg-background p-3 text-sm shadow-lg sm:flex-row sm:items-center"
      >
        <p>
          <span className="font-semibold">
            F3 Nation is having trouble loading data.
          </span>{" "}
          Workouts may be missing or out of date. Retrying automatically.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void retryFailedQueries(queryClient)}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
