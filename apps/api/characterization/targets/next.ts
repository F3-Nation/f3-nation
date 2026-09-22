import type { Invoke } from "../transport";
import { withRequestHeaders } from "../header-store";

/**
 * In-process dispatch mirroring Next's file-system routing. apps/api has three
 * route files, and the catch-all does NOT cover /docs — dispatching everything
 * to it would silently skip the docs and OpenAPI cases.
 *
 * One layer Next applies *before* handler matching is modelled here so goldens
 * encode what production returns: the implicit trailing-slash 308. (next.config.js
 * has no redirects() table anymore — apps/api's own /map redirect was dead code
 * removed in #648.)
 */
export const invokeNext: Invoke = async (request) => {
  const { pathname, search } = new URL(request.url);

  // Next unshifts a priority 308 for `/:path+/` -> `/:path+` (no trailingSlash
  // config), applied before any handler runs.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return new Response(null, {
      status: 308,
      headers: { location: pathname.replace(/\/+$/, "") + search },
    });
  }

  const headers = new Headers(request.headers);
  // Real deployments always send `host`; a hand-built Request carries none, so
  // synthesize it to keep goldens off hand-built-Request behavior.
  if (!headers.has("host")) headers.set("host", new URL(request.url).host);
  const scoped = new Request(request, { headers });

  const res = await withRequestHeaders(headers, async () => {
    // /docs and /docs/openapi.json export GET only; Next's route-handler layer
    // synthesizes 405 for other verbs plus an auto-OPTIONS, so model both.
    if (pathname === "/docs" || pathname === "/docs/openapi.json") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { allow: "GET, HEAD, OPTIONS" },
        });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      if (pathname === "/docs/openapi.json") {
        const { GET } = await import("../../src/app/docs/openapi.json/route");
        return GET(scoped);
      }
      const { GET } = await import("../../src/app/docs/route");
      return GET();
    }
    // The catch-all's seven method exports are all the same handleRequest, which
    // reads request.method itself, so calling GET is safe for every method.
    const { GET } = await import("../../src/app/[[...rest]]/route");
    return GET(scoped);
  });

  // Over the wire a HEAD response never carries a body; strip it so the
  // in-process `next` target agrees with `live`/`hono` on every HEAD golden.
  return request.method === "HEAD"
    ? new Response(null, { status: res.status, headers: res.headers })
    : res;
};
