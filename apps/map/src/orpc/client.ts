import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";

declare global {
  var $client: RouterClient<typeof router> | undefined;
}

const PROXY_PREFIX = "/api/orpc";

/**
 * Fetches through the map's proxy and reads the whole body here. When the API
 * stalls mid-body the proxy can only cut the stream (it already sent a 200),
 * and the browser reports that as a vendor-specific network TypeError that
 * `isApiUnavailableError` can't tell apart from a bug — so turn it into the
 * same 503 the proxy sends when the API never answers.
 */
export async function proxyFetch(
  input: Request,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: input.headers,
  });
  if (!response.body) return response;

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      status: 503,
      message: "The F3 Nation API stopped sending its response.",
      cause: err,
    });
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const link = new RPCLink({
  url: () => `${window.location.origin}${PROXY_PREFIX}${API_PREFIX_V1}`,
  fetch: proxyFetch,
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
