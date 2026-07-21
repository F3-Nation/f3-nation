"use client";

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { Suspense, useEffect, useState } from "react";

import { isDevelopment } from "@acme/shared/common/constants";

import { createQueryClient } from "~/orpc/query-client";
import { client } from "./client";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    return createQueryClient();
  } else {
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

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
