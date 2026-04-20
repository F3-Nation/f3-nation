"use client";

import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type {
  InferDataFromTag,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { Suspense, useEffect, useState } from "react";

import type { router } from "@acme/api";
import { isDevelopmentNodeEnv } from "@acme/shared/common/constants";

import { createQueryClient } from "~/orpc/query-client";
import { client } from "./client";

export type Outputs = InferRouterOutputs<typeof router>;
export type Inputs = InferRouterInputs<typeof router>;

let clientQueryClientSingleton: QueryClient | undefined = undefined;
export const getQueryClient = () => {
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
  const [showDevtools, setShowDevtools] = useState(isDevelopmentNodeEnv);

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

export function invalidateQueries(
  keyOrOptions?: string | Parameters<QueryClient["invalidateQueries"]>[0],
) {
  if (typeof keyOrOptions === "string") {
    return getQueryClient().invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey;
        return (
          Array.isArray(queryKey) &&
          queryKey.length > 0 &&
          (queryKey[0] === keyOrOptions ||
            (Array.isArray(queryKey[0]) && queryKey[0][0] === keyOrOptions))
        );
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
