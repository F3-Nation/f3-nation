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
 * Invalidate by router segment; oRPC stores the path array at `queryKey[0]`
 * (the `Array.isArray` guard below covers non-oRPC keys), so a segment
 * matches at any depth. See `apps/map/__tests__/orpc/react.test.ts`.
 *
 * @example
 * // Matches "location", "map.location", etc.
 * await invalidateQueries("location");
 *
 * // Passing query options directly
 * void invalidateQueries(orpc.request.all.queryOptions());
 *
 * // Custom predicate when needed
 * await invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey[0]) && query.queryKey[0][0] === "location" });
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
