import type { Invoke } from "../transport";

/**
 * Black-box target used by #650's staging gate. Only the read-only smoke
 * subset runs here — anything needing DB fixtures or in-process rate-limit
 * state is gated off with the `target.inProcess` check.
 */
export function makeLiveInvoke(baseUrl: string): Invoke {
  // A path prefix on baseUrl would be silently dropped by `new URL(path, base)`
  // (`https://host/api` + `/v1/x` -> `https://host/v1/x`), turning a config
  // mistake into a wall of confusing 404s.
  if (new URL(baseUrl).pathname !== "/") {
    throw new Error(
      `CHAR_TEST_BASE_URL must have no path prefix, got: ${baseUrl}`,
    );
  }

  return async (request) => {
    const url = new URL(request.url);
    const destination = new URL(url.pathname + url.search, baseUrl);
    try {
      return await fetch(new Request(destination, request), {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // undici hides the real reason (ECONNREFUSED/ENOTFOUND/CERT_*) on
      // err.cause, and a hung host would otherwise block until the test timeout.
      throw new Error(
        `live target request failed: ${request.method} ${destination.toString()}`,
        { cause: err },
      );
    }
  };
}
