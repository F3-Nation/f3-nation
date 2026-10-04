import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { logWarn } from "~/lib/logging";

const PROXY_PREFIX = "/api/orpc";

// Anonymous-reachable paths the map calls — see specs/map-browse-and-search.md
// AC-1. These back onto `publicReadProcedure` (packages/api/src/shared.ts),
// which requires no credential at all, so the proxy forwards them as-is
// (cookies included, in case a signed-in caller's session is useful to the
// handler — none of these currently use it, but there's no harm in passing
// it through). This is a defense-in-depth allowlist, not the auth boundary:
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

// Signed-in-only paths the map calls — see specs/map-update-request-flow.md
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

  const upstreamResponse = await fetch(getTargetUrl(request, proxiedPath), {
    method,
    headers: getForwardedHeaders(request),
    body,
  });

  const headers = new Headers(upstreamResponse.headers);
  // fetch() already decoded the body; these describe the encoded bytes.
  headers.delete("content-encoding");
  headers.delete("content-length");
  // These responses can carry PII scoped to the caller's own session
  // (see SIGNED_IN_ONLY_PATHS above) — never let a shared browser cache or
  // intermediate proxy retain a copy for the next visitor on this device.
  if (isSignedInOnly) headers.set("Cache-Control", "no-store");
  return new Response(upstreamResponse.body, {
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
