import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { isUpstreamFailureResponse } from "@acme/shared/app/api-availability";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";

declare global {
  var $client: RouterClient<typeof router> | undefined;
}

const PROXY_PREFIX = "/api/orpc";

/**
 * How long to wait for the API to start answering. Only the wait for response
 * headers is bounded, not the body: the map datasets are large and a slow
 * connection may legitimately take longer to download them.
 */
export const API_RESPONSE_TIMEOUT_MS = 20_000;

const link = new RPCLink({
  url: () => `${window.location.origin}${PROXY_PREFIX}${API_PREFIX_V1}`,
  fetch: async (input, init) => {
    // Not AbortSignal.any(): it is missing from browsers older than 2024.
    const controller = new AbortController();
    // oRPC puts the caller's signal on the Request itself, and `signal` below
    // replaces it, so forward its abort.
    const callerSignal = input.signal;
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new DOMException("API did not respond", "TimeoutError"));
    }, API_RESPONSE_TIMEOUT_MS);
    const signal = controller.signal;

    let response: Response;
    try {
      response = await fetch(input, {
        ...init,
        signal,
        credentials: "include",
        headers: input.headers,
      });
    } catch (error) {
      // The caller cancelling the query (unmount, navigation) is not an outage.
      if (callerSignal.aborted) throw error;
      // Browsers reject a failed connection with an unhelpful, browser-specific
      // TypeError ("Failed to fetch", "Load failed", ...). Name it once here so
      // the rest of the app can tell an outage from a bug.
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        status: 503,
        message: "Could not reach the F3 Nation API",
        cause: error,
      });
    } finally {
      // Only the wait for headers is timed. The caller's abort stays linked, so
      // cancelling the query still stops a body that is mid-download.
      clearTimeout(timer);
    }

    // A 5xx page from the proxy or a load balancer (not a JSON oRPC error)
    // would otherwise surface as a body-parse error with its status lost.
    if (isUpstreamFailureResponse(response)) {
      await response.body?.cancel();
      throw new ORPCError("SERVICE_UNAVAILABLE", { status: response.status });
    }
    return response;
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
