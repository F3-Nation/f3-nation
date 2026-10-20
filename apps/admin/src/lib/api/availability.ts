import { ORPCError } from "@orpc/client";

/**
 * Upper bound on server-side API calls made while rendering the root layout.
 * Without it, an API that accepts connections but never answers (e.g. its
 * database is down) leaves every admin page on a blank screen indefinitely.
 */
export const API_REQUEST_TIMEOUT_MS = 8_000;

/**
 * True when an API call failed because the API itself could not serve it:
 * connection failure, timeout, or a 5xx. A 4xx means the API answered, so it
 * is not an outage.
 */
export function isApiUnavailableError(error: unknown): boolean {
  if (error instanceof ORPCError) return error.status >= 500;
  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  // Node's fetch (undici) rejects with this exact TypeError on DNS, refused,
  // or reset connections. Matching the message keeps ordinary TypeErrors from
  // bugs out of the outage path.
  return error instanceof TypeError && error.message === "fetch failed";
}
