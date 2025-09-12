"use client";

import type { QueryClient } from "@tanstack/react-query";
import React, { Suspense, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCQueryUtils,
  createTRPCReact,
  httpLink,
  loggerLink,
} from "@trpc/react-query";
import SuperJSON from "superjson";

import type { AppRouter } from "@acme/api";
import { AppType } from "@acme/shared/app/constants";
import { isDevelopment } from "@acme/shared/common/constants";
import { Header } from "@acme/shared/common/enums";

import { createQueryClient } from "./query-client";
import { getBaseUrl } from "./util";

export const api = createTRPCReact<AppRouter>();

export const createTrpcClient = () => {
  return api.createClient({
    links: [
      loggerLink({
        enabled: (op) =>
          isDevelopment ||
          (op.direction === "down" && op.result instanceof Error),
      }),
      httpLink({
        transformer: SuperJSON,
        url: getBaseUrl() + "/api/trpc",
        headers() {
          const headers = new Headers();
          headers.set(Header.Source, AppType.WEB);
          return headers;
        },
      }),
    ],
  });
};

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  } else {
    // Browser: use singleton pattern to keep the same query client
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

let clientTrpcClientSingleton: ReturnType<typeof createTrpcClient> | undefined =
  undefined;
const getTrpcClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new trpc client
    return createTrpcClient();
  } else {
    // Browser: use singleton pattern to keep the same trpc client
    return (clientTrpcClientSingleton ??= createTrpcClient());
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

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [showDevtools, setShowDevtools] = useState(isDevelopment);

  const [trpcClient] = useState(() => getTrpcClient());

  useEffect(() => {
    // @ts-expect-error -- add toggleDevtools to window
    window.toggleDevtools = () => setShowDevtools((old) => !old);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
        {showDevtools && (
          <Suspense fallback={null}>
            <ReactQueryDevtoolsProduction buttonPosition="bottom-right" />
          </Suspense>
        )}
      </api.Provider>
    </QueryClientProvider>
  );
}

export const queryClientUtils = createTRPCQueryUtils({
  queryClient: getQueryClient(),
  client: getTrpcClient(),
});
