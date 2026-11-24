import { NextResponse } from "next/server";

/**
 * Blocks cross-site writes to routes that act on the session cookie.
 *
 * Browsers send `Sec-Fetch-Site`, which page script can't set; only a
 * same-origin request or one the user started (`none`) gets through. A
 * browser too old to send it still sends `Origin` on a POST, which must match
 * the `Host` the request was made to. A request with neither header didn't
 * come from a browser, so it can't be carrying a victim's cookie.
 *
 * With `requireJson`, the body must also be `application/json`: a cross-site
 * form can only send `text/plain`, urlencoded or multipart bodies, and a
 * cross-site `fetch` with a JSON type needs a CORS preflight these routes
 * never approve.
 *
 * Returns the error response to send, or `null` when the request may proceed.
 */
export function rejectCrossSiteWrite(
  request: Request,
  { requireJson = false }: { requireJson?: boolean } = {},
): NextResponse | null {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: "cross_site_request" }, { status: 403 });
  }

  if (requireJson && !isJson(request.headers.get("content-type"))) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  return null;
}

function isCrossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    // An opaque origin ("null") comes from a sandboxed frame or a redirect
    // chain, never from this app's own pages.
    return true;
  }
}

function isJson(contentType: string | null): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}
