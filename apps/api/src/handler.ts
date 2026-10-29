import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError, ORPCError, ValidationError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin, RequestHeadersPlugin } from "@orpc/server/plugins";

import { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { getBaseUrl } from "~/lib/get-base-url";
import { logError, logWarn } from "~/lib/logging";

/**
 * Report a procedure error from the oRPC interceptors. A 4xx ORPCError with
 * no underlying cause is an expected client-side outcome — rate limiting,
 * bad credentials, input validation, a conflict — so it is logged at warn
 * (stdout / Cloud Logging only) instead of logError, which also forwards to
 * the error tracker, so expected client errors (e.g. a 429 burst) don't bury
 * real errors. A 4xx carrying a `cause` wraps a fault of ours and still goes
 * through logError, except oRPC's own input-validation cause, which is the
 * caller's. 5xx ORPCErrors and anything that isn't an ORPCError always go
 * through logError.
 *
 * Only status and code are logged, never the message: client-facing
 * messages can echo user input (the duplicate-email BAD_REQUEST includes
 * the submitted address).
 */
export function reportHandlerError(
  event: string,
  ctx: Record<string, unknown>,
  error: unknown,
): void {
  if (
    error instanceof ORPCError &&
    error.status < 500 &&
    (error.cause == null || error.cause instanceof ValidationError)
  ) {
    logWarn(event, {
      ...ctx,
      status: error.status,
      code: error.code,
      // Non-PII discriminator for a 4xx that carried a cause. Labelled
      // explicitly: oRPC's ValidationError reports its name as "Error".
      ...(error.cause instanceof ValidationError
        ? { causeType: "ValidationError" }
        : {}),
    });
    return;
  }
  logError(event, ctx, error);
}

/**
 * Public, non-credentialed CORS. Any origin may call the API from a browser,
 * but never with ambient credentials: there is no
 * `Access-Control-Allow-Credentials`, so a browser never lets a page on
 * another origin read a response to a request that carried the session
 * cookie, and a credentialed non-simple request (such as a JSON POST) fails
 * its preflight. This is a browser-side rule, not a server-side one: a simple
 * cross-origin request (a GET, or a POST with a form or text/plain body) is
 * still sent with the cookie from any same-site `*.f3nation.com` page, since
 * the cookie is SameSite=Lax. Procedures reachable that way must not change
 * state on a cookie session alone. Browser callers authenticate with an
 * `Authorization: Bearer` header instead.
 *
 * Why `*` rather than an origin allow-list: this is a public Bearer-token API.
 * Browser apps outside our own app URLs call it directly with an API key
 * (apps/homepage on apps.f3nation.com, and regional F3 websites), and an
 * allow-list would break them. First-party browser sessions never need CORS:
 * map and admin reach the API through their same-origin /api/orpc proxies,
 * which call it server-side (map forwards the session cookie, admin swaps it
 * for a Bearer token).
 *
 * Never echo the request origin while also allowing credentials: that would
 * let any web page act as a signed-in user and read the result.
 *
 * `*` is stamped on every response, including ones to requests with no
 * `Origin` header, and there is no `Vary: Origin` because the answer never
 * depends on the origin. Both are intended.
 */
const corsPlugin = new CORSPlugin({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: [Header.ContentType, Header.Authorization, Header.Client],
  maxAge: 600,
  credentials: false,
});

const handler = new RPCHandler(router, {
  plugins: [corsPlugin, new RequestHeadersPlugin()],
  interceptors: [
    onError((error, { request }) => {
      reportHandlerError(
        "api.rpc.handler_error",
        { path: request.url.pathname, method: request.method },
        error,
      );
    }),
  ],
});

const openAPIHandler = new OpenAPIHandler(router, {
  plugins: [corsPlugin, new RequestHeadersPlugin()],
  interceptors: [
    onError((error, { request }) => {
      reportHandlerError(
        "api.openapi.handler_error",
        { path: request.url.pathname, method: request.method },
        error,
      );
    }),
  ],
});

/**
 * Marks a response uncacheable unless it already carries Cache-Control. A
 * response can depend on who is asking (a signed-in caller may see fields an
 * anonymous caller can't), so a shared cache keyed on the URL alone could hand
 * one caller's data to another. Setting the header here keeps that decision
 * away from whatever proxy or CDN sits in front of the API. A procedure can
 * set its own Cache-Control by returning headers from an OpenAPI route with
 * `outputStructure: "detailed"`, or through `context.resHeaders` once the
 * handler serving it installs oRPC's `ResponseHeadersPlugin`. Either way, it
 * should opt in to caching only for a response that is identical for every
 * caller.
 */
function withDefaultCacheControl(response: Response): Response {
  if (!response.headers.has("cache-control")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export async function handleRequest(request: Request): Promise<Response> {
  // Redirect to /docs if the request is for /
  if (new URL(request.url).pathname === "/") {
    return Response.redirect(`${getBaseUrl(request)}/docs`);
  }

  // Check if this is an oRPC client request.
  // oRPC clients send a custom header to identify themselves.
  const isOrpcClient =
    request.headers.get(Header.Client) === Client.ORPC ||
    request.headers.get(Header.Client) === Client.ORPC_SSG ||
    request.headers.get(Header.Client) === Client.F3_ME ||
    request.headers.get(Header.Client) === Client.F3_REGION_PAGES;

  if (isOrpcClient) {
    // Use RPC handler for oRPC client requests
    const { response } = await handler.handle(request, {
      prefix: API_PREFIX_V1,
    });
    return withDefaultCacheControl(
      response ?? new Response("Not found", { status: 404 }),
    );
  }

  // Use OpenAPI handler for REST-style calls (docs, curl, external clients)
  const { response: openApiResponse } = await openAPIHandler.handle(request, {
    prefix: "/",
  });

  return withDefaultCacheControl(
    openApiResponse ?? new Response("Not found", { status: 404 }),
  );
}
