"use client";

import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";
import type {
  InferDataFromTag,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import React, { Suspense, useEffect, useState } from "react";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClientProvider } from "@tanstack/react-query";

import type { router } from "@acme/api";
import { isDevelopmentNodeEnv } from "@acme/shared/common/constants";

import { createQueryClient } from "~/orpc/query-client";
import { client } from "./client";

export type Outputs = InferRouterOutputs<typeof router>;
export type Inputs = InferRouterInputs<typeof router>;

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
  ...args: Parameters<QueryClient["invalidateQueries"]>
) {
  return getQueryClient().invalidateQueries(...args);
}

export function getQueryData<
  TQueryFnData = unknown,
  TTaggedQueryKey extends QueryKey = QueryKey,
  TInferredQueryFnData = InferDataFromTag<TQueryFnData, TTaggedQueryKey>,
>(queryKey: TTaggedQueryKey): TInferredQueryFnData | undefined {
  return getQueryClient().getQueryData(queryKey);
}
