/**
 * Black-box target used by #650's staging gate. Only the read-only smoke
 * subset runs here — anything needing DB fixtures or in-process rate-limit
 * state is gated off with `describe.runIf(target.kind !== "live")`.
 */
export function makeLiveInvoke(baseUrl: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const destination = new URL(url.pathname + url.search, baseUrl);
    return fetch(new Request(destination, request), { redirect: "manual" });
  };
}
