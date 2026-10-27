import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ORPCError } from "@orpc/client";
import { StandardRPCJsonSerializer } from "@orpc/client/standard";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { logWarn } from "~/lib/logging";

const PROXY_PREFIX = "/api/orpc";

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

// How long the API may take to send headers, and to send each next chunk of a
// body. Without it, an API that accepts connections but never answers leaves
// every map request pending forever.
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

function getUpstreamTimeoutMs(): number {
  const parsed = Number(process.env.F3_API_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

const serializer = new StandardRPCJsonSerializer();

/**
 * A 503 in oRPC's error format, so the map's client reads it as an
 * `ORPCError` with status 503 — which `isApiUnavailableError` treats as an
 * outage — instead of a fetch failure it can't classify.
 */
function apiUnavailableResponse(): Response {
  const [json, meta] = serializer.serialize(
    new ORPCError("SERVICE_UNAVAILABLE", {
      status: 503,
      message: "The F3 Nation API is not responding.",
    }).toJSON(),
  );
  return NextResponse.json(
    { json, meta },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Passes `body` through, failing it if the API goes quiet for `timeoutMs`
 * mid-body. The timer runs only while waiting on the API, not while the
 * browser is slow to take the next chunk. Reads go through our own reader
 * because Next's patched fetch can hand back a copied body that aborting the
 * request never reaches.
 */
export function withStallTimeout<T>(
  body: ReadableStream<T>,
  timeoutMs: number,
  onFailure: (err: unknown) => void,
): ReadableStream<T> {
  const reader = body.getReader();
  // Set when the browser goes away. Cancelling ends a pending read with
  // `done`, and closing our already-cancelled stream would then throw and be
  // logged as an API failure.
  let cancelled = false;
  return new ReadableStream<T>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DOMException("API stopped sending", "TimeoutError")),
          timeoutMs,
        );
      });
      try {
        const { done, value } = await Promise.race([reader.read(), stalled]);
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        if (cancelled) return;
        // Not awaited: cancelling one branch of a copied body settles only
        // once the other branch is cancelled too.
        void reader.cancel(err).catch(() => undefined);
        onFailure(err);
        controller.error(err);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
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

  const timeoutMs = getUpstreamTimeoutMs();
  const upstream = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => upstream.abort(), timeoutMs);
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(getTargetUrl(request, proxiedPath), {
      method,
      headers: getForwardedHeaders(request),
      body,
      signal: upstream.signal,
    });
  } catch (err) {
    logWarn("map.orpc_proxy.upstream_unavailable", {
      path: proxiedPath,
      timedOut: upstream.signal.aborted,
      durationMs: Date.now() - startedAt,
      err,
    });
    return apiUnavailableResponse();
  } finally {
    clearTimeout(timer);
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
  let responseBody =
    upstreamResponse.body &&
    withStallTimeout(upstreamResponse.body, timeoutMs, (err) => {
      // Headers already went out, so the browser sees a failed download
      // rather than a 503; this log is the only record of why.
      upstream.abort();
      logWarn("map.orpc_proxy.upstream_body_failed", {
        path: proxiedPath,
        durationMs: Date.now() - startedAt,
        err,
      });
    });
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
