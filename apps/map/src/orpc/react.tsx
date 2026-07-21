"use client";

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type {
  InferDataFromTag,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { Suspense, useEffect, useState } from "react";

import { isDevelopment } from "@acme/shared/common/constants";

import { createQueryClient } from "~/orpc/query-client";
import { client } from "./client";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
export const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  } else {
    // Browser: use singleton pattern to keep the same query client
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

// https://tanstack.com/query/latest/docs/framework/react/devtools
const ReactQueryDevtoolsProduction = React.lazy(() =>
  import("@tanstack/react-query-devtools/build/modern/production.js").then(
    (d) => ({
      default: d.ReactQueryDevtools,
    }),
  ),
);

export function OrpcReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [showDevtools, setShowDevtools] = useState(isDevelopment);

  useEffect(() => {
    // @ts-expect-error -- add toggleDevtools to window
    window.toggleDevtools = () => setShowDevtools((old) => !old);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
      {showDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtoolsProduction buttonPosition="bottom-right" />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

export const orpc = createTanstackQueryUtils(client);
export { ORPCError } from "@orpc/client";
export { useMutation, useQuery } from "@tanstack/react-query";

/**
 * Invalidate queries by router segment name or with custom options.
 *
 * oRPC's `createTanstackQueryUtils` always encodes the full router path as an
 * array in `queryKey[0]` — e.g. `orpc.map.location.eventsAndLocations` produces
 * `queryKey[0] === ["map", "location", "eventsAndLocations"]`, even for
 * single-segment routers (`["location"]`). When passed a string, this matches
 * any query whose path includes that segment anywhere, so a nested router like
 * `map.location` is still reached by `invalidateQueries("location")`.
 *
 * @example
 * // Matches "location", "map.location", etc.
 * await invalidateQueries("location");
 *
 * // Passing query options directly
 * void invalidateQueries(orpc.request.all.queryOptions());
 *
 * // Custom predicate when needed
 * await invalidateQueries({ predicate: (query) => query.queryKey[0]?.[0] === "location" });
 */
export function invalidateQueries(
  keyOrOptions?: string | Parameters<QueryClient["invalidateQueries"]>[0],
) {
  if (typeof keyOrOptions === "string") {
    return getQueryClient().invalidateQueries({
      predicate: (query) => {
        const path = query.queryKey[0];
        return Array.isArray(path) && path.includes(keyOrOptions);
      },
    });
  }
  return getQueryClient().invalidateQueries(keyOrOptions);
}

export function getQueryData<
  TQueryFnData = unknown,
  TTaggedQueryKey extends QueryKey = QueryKey,
  TInferredQueryFnData = InferDataFromTag<TQueryFnData, TTaggedQueryKey>,
>(queryKey: TTaggedQueryKey): TInferredQueryFnData | undefined {
  return getQueryClient().getQueryData(queryKey);
}
