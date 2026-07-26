import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped header store backing the `next/headers` alias shim. Lives in
 * its own module so both the shim and the transport target can reach it
 * without a circular import.
 */
export const headerStore = new AsyncLocalStorage<Headers>();

/** Run `fn` with `headers()` resolving to the given request's headers. */
export function withRequestHeaders<T>(headers: Headers, fn: () => T): T {
  return headerStore.run(headers, fn);
}
