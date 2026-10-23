/**
 * Helpers for apps that call the F3 Nation API and want to show an outage
 * screen, rather than a crash or a misleading error, when it is down.
 *
 * Deliberately free of `@orpc/client` imports (this package does not depend on
 * it), so an oRPC error is recognised by its shape: `status`, `code` and
 * `defined` are what `ORPCError` carries. Each app has a test that runs its
 * real oRPC client against a stubbed `fetch` to pin that contract.
 */

/** How often an outage screen re-checks the API. */
export const API_RETRY_BASE_MS = 30_000;

// Every open tab lands on the outage screen at the same moment an outage
// starts; jitter keeps their retries from arriving at the recovering API as
// one synchronized wave.
const API_RETRY_JITTER = 0.2;

export function apiRetryDelayMs(random: () => number = Math.random): number {
  return Math.round(
    API_RETRY_BASE_MS * (1 + (random() * 2 - 1) * API_RETRY_JITTER),
  );
}

function isOrpcErrorLike(error: Error): error is Error & { status: number } {
  const candidate = error as Error & Record<string, unknown>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    "defined" in candidate
  );
}

/**
 * True when an API call failed because the API itself could not serve it:
 * connection failure, timeout, or a 5xx. A 4xx means the API answered, so it
 * is not an outage.
 */
export function isApiUnavailableError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name } = error as { name?: unknown };
  // Matched by name, not `instanceof DOMException`: the abort reasons Node
  // and the browser create can come from a different realm than the global
  // DOMException (a test's jsdom, an iframe), so `instanceof` can miss them.
  // A bare `AbortError` is deliberately NOT an outage: it is what the caller
  // cancelling a request (unmount, navigation) produces. Clients that bound
  // their own wait abort with a `TimeoutError` reason instead.
  if (name === "TimeoutError") return true;
  if (!(error instanceof Error)) return false;
  if (isOrpcErrorLike(error)) return error.status >= 500;
  // Node's fetch (undici) rejects with "fetch failed" on DNS, refused, or
  // reset connections before headers, and "terminated" when the socket closes
  // mid-body. Matching the message keeps ordinary TypeErrors from bugs out of
  // the outage path.
  if (error instanceof TypeError) {
    return error.message === "fetch failed" || error.message === "terminated";
  }
  // oRPC wraps failures while reading the body (a timeout or dropped
  // connection after headers) in a plain Error with the real one as `cause`.
  // The depth cap guards against a cyclic cause chain.
  return depth < 3 && isApiUnavailableError(error.cause, depth + 1);
}

/**
 * Whether a response is a gateway or load-balancer failure rather than an
 * answer from the API. oRPC cannot decode these (no JSON body, or no
 * content-type), so it would surface them as a body-parse error with the
 * status lost; callers turn them into an `ORPCError` before oRPC sees them.
 */
export function isUpstreamFailureResponse(response: Response): boolean {
  if (response.status < 500) return false;
  return !response.headers.get("content-type")?.startsWith("application/json");
}
