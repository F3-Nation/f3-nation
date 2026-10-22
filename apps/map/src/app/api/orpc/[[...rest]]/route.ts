import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { logWarn } from "~/lib/logging";

const PROXY_PREFIX = "/api/orpc";

// How long to wait for the API to start answering before treating it as down.
// Only the wait for response headers is bounded; the body streams afterwards.
const UPSTREAM_TIMEOUT_MS = 20_000;

// Anonymous-reachable paths the map calls — see docs/specs/map-browse-and-search.md
// AC-1. These back onto `publicReadProcedure` (packages/api/src/shared.ts),
// which requires no credential, so the proxy forwards them as-is. Cookies are
// still forwarded because these handlers read `ctx.session` to decide what to
// return: anonymous callers get active, non-private rows with contact fields
// masked; signed-in callers get full rows and `onlyMine` scoping.
// This is a defense-in-depth allowlist, not the auth boundary:
// the API itself now enforces which procedures anonymous callers may reach.
export const PUBLIC_PATHS = new Set([
  "/v1/ping",
  "/v1/map/location/eventsAndLocations",
  "/v1/map/location/getAOsInRegion",
  "/v1/map/location/locationIdToRegionNameLookup",
  "/v1/map/location/locationWorkout",
  "/v1/map/location/regionsWithLocation",
  "/v1/map/location/upcomingInstances",
  "/v1/map/location/workoutCount",
  "/v1/map/submitFeedback",
  "/v1/event/all",
  "/v1/event/byId",
  "/v1/event/eventIdToRegionNameLookup",
  "/v1/eventType/all",
  "/v1/location/all",
  "/v1/org/all",
  "/v1/org/byId",
]);

// Signed-in-only paths the map calls — see docs/specs/map-update-request-flow.md
// AC-1. Forwarded with the caller's own cookie; an anonymous caller gets
// UNAUTHORIZED from the API itself, since these remain `protectedProcedure`.
export const SIGNED_IN_ONLY_PATHS = new Set([
  "/v1/request/canEditRegions",
  "/v1/request/rejectSubmission",
  "/v1/request/submitCreateAOAndLocationAndEventRequest",
  "/v1/request/submitCreateEventRequest",
  "/v1/request/submitDeleteAORequest",
  "/v1/request/submitDeleteEventRequest",
  "/v1/request/submitEditAOAndLocationRequest",
  "/v1/request/submitEditEventRequest",
  "/v1/request/submitMoveAOToDifferentLocationRequest",
  "/v1/request/submitMoveAOToDifferentRegionRequest",
  "/v1/request/submitMoveAOToNewLocationRequest",
  "/v1/request/submitMoveEventToDifferentAoRequest",
  "/v1/request/submitMoveEventToNewAoRequest",
  "/v1/request/submitMoveEventToNewLocationRequest",
]);

function getApiBaseUrl(): string {
  const baseUrl = process.env.F3_API_BASE_URL;
  if (!baseUrl) throw new Error("F3_API_BASE_URL is required");

  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith(API_PREFIX_V1)
    ? normalized.slice(0, -API_PREFIX_V1.length)
    : normalized;
}

function getProxiedPath(request: NextRequest): string {
  const sourceUrl = new URL(request.url);
  return sourceUrl.pathname.slice(PROXY_PREFIX.length) || API_PREFIX_V1;
}

function getTargetUrl(request: NextRequest, proxiedPath: string): URL {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`${getApiBaseUrl()}${proxiedPath}`);
  targetUrl.search = sourceUrl.search;
  return targetUrl;
}

function getForwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  // Never let a caller supply their own bearer token or API key through this
  // proxy — cookie-based session auth (for SIGNED_IN_ONLY_PATHS) is the only
  // identity that reaches the API from here.
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set(Header.Client, Client.ORPC);

  return headers;
}

/**
 * Whether the caller's Accept-Encoding allows gzip. An explicit `gzip` entry
 * decides (so `gzip;q=0, *;q=1` refuses it); otherwise `*` does.
 */
export function acceptsGzip(request: Pick<NextRequest, "headers">): boolean {
  const q: Record<string, number> = {};
  for (const part of (request.headers.get("accept-encoding") ?? "").split(
    ",",
  )) {
    const [name, ...params] = part
      .split(";")
      .map((p) => p.trim().toLowerCase());
    if (!name) continue;
    const qParam = params.find((p) => p.startsWith("q="));
    q[name] = qParam === undefined ? 1 : Number(qParam.slice(2)) || 0;
  }
  const gzip = q.gzip ?? q["*"];
  return gzip !== undefined && gzip > 0;
}

async function proxyRequest(request: NextRequest) {
  const proxiedPath = getProxiedPath(request);

  const isPublic = PUBLIC_PATHS.has(proxiedPath);
  const isSignedInOnly = SIGNED_IN_ONLY_PATHS.has(proxiedPath);
  if (!isPublic && !isSignedInOnly) {
    // proxiedPath is unvalidated caller input precisely because it didn't
    // match either allowlist — don't let it land in logs as if it were a
    // trusted server-defined value.
    logWarn("map.orpc_proxy.path_not_allowed");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  // Built outside the try below: a missing F3_API_BASE_URL is a misconfiguration
  // and must surface as the 500 it is, not be reported as an API outage.
  const targetUrl = getTargetUrl(request, proxiedPath);
  const forwardedHeaders = getForwardedHeaders(request);

  // Cleared once headers arrive, so a large body can still stream afterwards.
  const upstreamTimeout = new AbortController();
  const upstreamTimer = setTimeout(() => {
    upstreamTimeout.abort(
      new DOMException("API did not respond", "TimeoutError"),
    );
  }, UPSTREAM_TIMEOUT_MS);
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: forwardedHeaders,
      body,
      signal: upstreamTimeout.signal,
    });
  } catch (err) {
    // The API refused the connection or never answered (it, or its database,
    // is down). Answer with a clean 503 rather than letting the throw become
    // an opaque 500 page, so the map can tell an outage from a bug.
    logWarn("map.orpc_proxy.upstream_unavailable", { err });
    return new Response("The F3 Nation API is unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } finally {
    clearTimeout(upstreamTimer);
  }

  const headers = new Headers(upstreamResponse.headers);
  // fetch() already decoded the body; these describe the encoded bytes.
  headers.delete("content-encoding");
  headers.delete("content-length");
  // Every path here forwards the caller's own cookie (see
  // getForwardedHeaders), including several PUBLIC_PATHS entries
  // (event/all, location/all, org/all, getAOsInRegion) whose response
  // still varies per caller via `onlyMine` for a signed-in editor. A
  // shared cache keyed on URL alone can't tell that apart from the
  // anonymous response for the same path/query, so every response here —
  // not just SIGNED_IN_ONLY_PATHS — must stay uncached.
  headers.set("Cache-Control", "no-store");

  // Compress JSON for the browser here, at the browser-facing hop. The API
  // doesn't compress (see apps/api/src/app.ts), so eventsAndLocations went out
  // as 1.5 MB on every map load. Doing it in the proxy can't break an older
  // map revision the way enabling it in the API could. Streams (e.g.
  // text/event-stream) and non-JSON bodies pass through untouched. Only
  // PUBLIC_PATHS responses are compressed: SIGNED_IN_ONLY_PATHS carry the
  // caller's own data, and leaving them uncompressed rules out BREACH-style
  // length leaks for the price of a few small responses.
  let responseBody = upstreamResponse.body;
  headers.append("Vary", "Accept-Encoding");
  if (
    isPublic &&
    responseBody &&
    method !== "HEAD" &&
    acceptsGzip(request) &&
    (headers.get("content-type") ?? "").includes("application/json")
  ) {
    responseBody = responseBody.pipeThrough(new CompressionStream("gzip"));
    headers.set("content-encoding", "gzip");
  }

  return new Response(responseBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
