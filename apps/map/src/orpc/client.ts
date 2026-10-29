import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { isUpstreamFailureResponse } from "@acme/shared/common/api-availability";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";

declare global {
  var $client: RouterClient<typeof router> | undefined;
}

const PROXY_PREFIX = "/api/orpc";

/**
 * How long to wait for the API to start answering, and then for each next
 * chunk of the body. The body as a whole is not timed: the map datasets are
 * large and a slow connection may legitimately take longer to download them.
 */
export const API_RESPONSE_TIMEOUT_MS = 20_000;

const timeoutReason = () =>
  new DOMException("API did not respond", "TimeoutError");

const unavailable = (cause: unknown) =>
  new ORPCError("SERVICE_UNAVAILABLE", {
    status: 503,
    message: "Could not reach the F3 Nation API",
    cause,
  });

/**
 * Re-streams `body` so a stall or a dropped connection mid-download fails as
 * an outage, and runs `done` once the body ends, fails or is cancelled.
 */
function watchBody(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  callerSignal: AbortSignal,
  done: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    clearTimeout(idle);
    done();
  };
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(timeoutReason()),
        API_RESPONSE_TIMEOUT_MS,
      );
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finish();
          stream.close();
        } else {
          stream.enqueue(chunk.value);
        }
      } catch (error) {
        finish();
        // Browsers word a dropped connection differently ("network error",
        // "Load failed", ...); name it here, as for a failed connection.
        stream.error(callerSignal.aborted ? error : unavailable(error));
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}

const link = new RPCLink({
  url: () => `${window.location.origin}${PROXY_PREFIX}${API_PREFIX_V1}`,
  fetch: async (input, init) => {
    // Not AbortSignal.any(): it is missing from browsers older than 2024.
    const controller = new AbortController();
    // oRPC puts the caller's signal on the Request itself, and `signal` below
    // replaces it, so forward its abort until the body is done.
    const callerSignal = input.signal;
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    const unlinkCaller = () =>
      callerSignal.removeEventListener("abort", onCallerAbort);
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(timeoutReason()),
      API_RESPONSE_TIMEOUT_MS,
    );
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
      unlinkCaller();
      // The caller cancelling the query (unmount, navigation) is not an outage.
      if (callerSignal.aborted) throw error;
      // Browsers reject a failed connection with an unhelpful, browser-specific
      // TypeError ("Failed to fetch", "Load failed", ...). Name it once here so
      // the rest of the app can tell an outage from a bug.
      throw unavailable(error);
    } finally {
      // From here on, watchBody times each chunk instead.
      clearTimeout(timer);
    }

    // A 5xx page from the proxy or a load balancer (not a JSON oRPC error)
    // would otherwise surface as a body-parse error with its status lost.
    if (isUpstreamFailureResponse(response)) {
      unlinkCaller();
      // Discarding the page can fail too; that must not replace this error.
      await response.body?.cancel().catch(() => undefined);
      throw new ORPCError("SERVICE_UNAVAILABLE", { status: response.status });
    }
    if (!response.body) {
      unlinkCaller();
      return response;
    }
    return new Response(
      watchBody(response.body, controller, callerSignal, unlinkCaller),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
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
