/**
 * GET /* — Host-header driven redirect catch-all (R5 Decision 3).
 *
 * Reads the incoming Host header, looks it up in the in-memory hostname
 * cache (populated from Neon every 60 seconds), and issues a 307
 * redirect to the region or stats target.
 *
 * Fail-open semantics — this handler NEVER returns 500. Any failure
 * (cache miss, DB down, unexpected error) sends the user to
 * `RUNTIME_FALLBACK_REDIRECT_URL` (default
 * `https://redirect.f3nation.com/not-provisioned`). That's the page
 * the admin UI points users at with a "your region is still
 * provisioning" message.
 *
 * Static segments (`/health`) are resolved before this catch-all by
 * the App Router, so the health endpoint is never served by this
 * handler.
 */

import type { NextRequest } from "next/server";

import { env } from "../../env";
import { logger } from "../../lib/logger";
import { resolveRedirect } from "../../lib/redirect-resolver";
import { getHostnameCache } from "../../lib/runtime-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectResponse(target: string): Response {
  // Manually construct the response instead of using NextResponse.redirect
  // — that helper would 307 to an absolute URL as expected, but we want
  // to be completely explicit about headers for the probe and for
  // logging.
  return new Response(null, {
    status: 307,
    headers: {
      location: target,
      "cache-control": "no-store",
      "x-redirect-platform": "ok",
    },
  });
}

function hostFromRequest(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const host = hostFromRequest(request);
  const path = new URL(request.url).pathname;

  try {
    const cache = await getHostnameCache();
    const result = resolveRedirect(host, path, cache.get.bind(cache));

    logger.debug("runtime_request", {
      host: result.hostname,
      path,
      kind: result.kind,
      is_stats_host: result.isStatsHost,
    });

    if (result.kind === "unknown_host") {
      return redirectResponse(env.RUNTIME_FALLBACK_REDIRECT_URL);
    }
    // result.target is always defined when kind is a redirect kind.
    return redirectResponse(result.target ?? env.RUNTIME_FALLBACK_REDIRECT_URL);
  } catch (error) {
    // Fail-open. Anything that reaches this block is by definition a
    // bug or an outage — log it and 307 to the fallback so the tenant
    // still lands somewhere.
    logger.error("runtime_request_failed_open", {
      host,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return redirectResponse(env.RUNTIME_FALLBACK_REDIRECT_URL);
  }
}

// Browsers may probe apex with HEAD before navigating. Same handler.
export const HEAD = GET;
