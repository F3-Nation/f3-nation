"use client";

import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";
import type { QueryClient } from "@tanstack/react-query";
import React from "react";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClientProvider } from "@tanstack/react-query";

import type { router } from "@acme/api-orpc";

import { createQueryClient } from "~/trpc/query-client";
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

export function OrpcReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
}

export const orpc = createTanstackQueryUtils(client);
