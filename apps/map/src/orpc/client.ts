import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { env } from "~/env";

declare global {
  // eslint-disable-next-line no-var
  var $client: RouterClient<typeof router> | undefined;
}

const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_API_URL}${API_PREFIX_V1}`,
  // fetch: ensure cookies are sent along for auth
  fetch: (input, init) => {
    input.headers.set(Header.Client, Client.ORPC); // Identifies this as an oRPC client request

    // Always include the public API key for map access
    // This allows unauthenticated users to view the map
    const publicApiKey = env.NEXT_PUBLIC_MAP_API_KEY;
    if (publicApiKey) {
      input.headers.set(Header.Authorization, `Bearer ${publicApiKey}`);
    }

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
