import { withRequestHeaders } from "../header-store";

/**
 * In-process dispatch mirroring Next's file-system routing. apps/api has three
 * route files, and the catch-all does NOT cover /docs — dispatching everything
 * to it would silently skip the docs and OpenAPI cases.
 */
export async function invokeNext(request: Request): Promise<Response> {
  const headers = new Headers(request.headers);
  // A hand-built Request carries no `host`, but @auth/core's createActionURL
  // needs one (AUTH_URL/NEXTAUTH_URL are unset) or it throws inside new URL().
  if (!headers.has("host")) headers.set("host", new URL(request.url).host);
  const scoped = new Request(request, { headers });

  const { pathname } = new URL(request.url);

  return withRequestHeaders(headers, async () => {
    if (pathname === "/docs/openapi.json") {
      const { GET } = await import("../../src/app/docs/openapi.json/route");
      return GET(scoped);
    }
    if (pathname === "/docs") {
      const { GET } = await import("../../src/app/docs/route");
      return GET();
    }
    // All method exports of the catch-all are the same handleRequest.
    const { GET } = await import("../../src/app/[[...rest]]/route");
    return GET(scoped);
  });
}
