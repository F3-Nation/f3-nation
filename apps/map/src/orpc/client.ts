import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";

declare global {
  var $client: RouterClient<typeof router> | undefined;
}

const PROXY_PREFIX = "/api/orpc";

const link = new RPCLink({
  url: () => `${window.location.origin}${PROXY_PREFIX}${API_PREFIX_V1}`,
  fetch: (input, init) => {
    return fetch(input, {
      ...init,
      credentials: "include",
      headers: input.headers,
    });
  },
  interceptors: [
    onError((error: unknown) => {
      // Don't log expected abort errors
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        return;
      }
      console.error(error);
    }),
  ],
});

/**
 * Fallback to client-side client if server-side client is not available.
 */
export const client: RouterClient<typeof router> =
  globalThis.$client ?? createORPCClient(link);
