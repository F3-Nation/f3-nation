import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";

import { env } from "~/env";

declare global {
  // eslint-disable-next-line no-var
  var $client: RouterClient<typeof router> | undefined;
}

const link = new RPCLink({
  url: env.NEXT_PUBLIC_API_URL,
  // typeof window !== "undefined"
  //   ? // ? `${window.location.origin}/api/orpc`
  //     `${env.NEXT_PUBLIC_API_URL}/`
  //   : "/api/orpc",
  // fetch: ensure cookies are sent along for auth
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
  interceptors: [
    onError((error: unknown) => {
      console.error(error);
    }),
  ],
});

/**
 * Fallback to client-side client if server-side client is not available.
 */
export const client: RouterClient<typeof router> =
  globalThis.$client ?? createORPCClient(link);
