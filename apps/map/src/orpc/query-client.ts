import { StandardRPCJsonSerializer } from "@orpc/client/standard";
import {
  defaultShouldDehydrateQuery,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

const serializer = new StandardRPCJsonSerializer();

export const createQueryClient = () =>
  new QueryClient({
    // Central place to observe query failures. Without this, a failed fetch is
    // silent — e.g. a selector dropdown renders empty with no log. Fires once
    // per failure (not per render), so components only own the user-facing
    // error UI, not logging.
    queryCache: new QueryCache({
      onError: (error, query) => {
        console.error("map.query_failed", { queryKey: query.queryKey }, error);
      },
    }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
        gcTime: 30 * 60 * 1000,
        // Suppress abort errors - they're expected when queries are cancelled on unmount
        // This prevents console noise from expected behavior
        throwOnError: (error, query) => {
          // A failed background refresh of data we already have (e.g. the
          // SSG-hydrated map datasets) keeps showing that data; throwing would
          // replace a working map with the error boundary.
          if (query.state.data !== undefined) return false;
          // Don't throw abort errors - they're expected when components unmount
          if (
            error instanceof Error &&
            (error.name === "AbortError" ||
              error.message.includes("aborted") ||
              error.message.includes("signal is aborted"))
          ) {
            return false;
          }
          // Throw other errors normally
          return true;
        },
      },
      dehydrate: {
        serializeData(data) {
          const [json, meta] = serializer.serialize(data);
          return { json, meta };
        },
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData(data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          return serializer.deserialize(data.json, data.meta);
        },
      },
    },
  });

/**
 * staleTime for the map's two whole-map datasets (eventsAndLocations,
 * regionsWithLocation). They are large (~1.5 MB / 70 KB), identical for every
 * visitor and change rarely; the 30s default refetched them on every window
 * focus. Edits made from the map still show at once: submitting one calls
 * invalidateQueries("map"), which refetches regardless of staleTime. An edit
 * made elsewhere (admin) reaches an already-open tab on its next refetch
 * trigger (a remount, window focus or reconnect) once this window plus the
 * API's MAP_DATA_TTL_MS has passed; staleTime alone never refetches. A page
 * load refetches only when its server-rendered copy is older than this.
 */
export const MAP_DATASET_STALE_TIME_MS = 5 * 60 * 1000;
