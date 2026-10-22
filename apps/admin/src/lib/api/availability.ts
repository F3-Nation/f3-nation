import { ORPCError } from "@orpc/client";

/**
 * Upper bound on the server-side profile lookup that loads a session's roles.
 * Without it, an API that accepts connections but never answers (e.g. its
 * database is down) leaves admin pages hanging indefinitely.
 */
export const API_REQUEST_TIMEOUT_MS = 8_000;

/**
 * True when an API call failed because the API itself could not serve it:
 * connection failure, timeout, or a 5xx. A 4xx means the API answered, so it
 * is not an outage.
 */
export function isApiUnavailableError(error: unknown, depth = 0): boolean {
  if (error instanceof ORPCError) return error.status >= 500;
  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
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
  return (
    depth < 3 &&
    error instanceof Error &&
    isApiUnavailableError(error.cause, depth + 1)
  );
}
