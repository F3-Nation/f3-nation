import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

const PROXY_PREFIX = "/api/orpc";

// Paths that don't require the caller's own session token — see
// specs/map-browse-and-search.md AC-1. Some (like ping) are truly open;
// others (like org.byId) still need a token upstream, just not the user's —
// so the map's own API key is attached to all of them.
const MAP_KEY_PATHS = new Set([
  "/v1/ping",
  "/v1/map/location/eventsAndLocations",
  "/v1/map/location/getAOsInRegion",
  "/v1/map/location/locationIdToRegionNameLookup",
  "/v1/map/location/locationWorkout",
  "/v1/map/location/regionsWithLocation",
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
// AC-1. Forwarded with the caller's own cookie, never the map API key, so an
// anonymous caller gets UNAUTHORIZED from the API itself.
const SIGNED_IN_ONLY_PATHS = new Set([
  "/v1/request/canEditRegions",
  "/v1/request/all",
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

function getForwardedHeaders(
  request: NextRequest,
  attachMapApiKey: boolean,
): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set(Header.Client, Client.ORPC);

  const mapApiKey = process.env.F3_MAP_API_KEY;
  if (attachMapApiKey && mapApiKey) {
    headers.set(Header.Authorization, `Bearer ${mapApiKey}`);
  }

  return headers;
}

async function proxyRequest(request: NextRequest) {
  const proxiedPath = getProxiedPath(request);

  const usesMapKey = MAP_KEY_PATHS.has(proxiedPath);
  const isSignedInOnly = SIGNED_IN_ONLY_PATHS.has(proxiedPath);
  if (!usesMapKey && !isSignedInOnly) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  return fetch(getTargetUrl(request, proxiedPath), {
    method,
    headers: getForwardedHeaders(request, usesMapKey),
    body,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
