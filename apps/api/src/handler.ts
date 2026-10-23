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
 * another origin read the response to a request that carried the
 * `.f3nation.com` session cookie, and non-simple requests (JSON POSTs) are stopped at the preflight.
 * This is a browser-side rule, not a server-side one: a simple cross-origin
 * request (such as a GET) can still be sent with the cookie, so GET procedures
 * must stay free of side effects. Browser callers authenticate with an
 * `Authorization: Bearer` header instead.
 *
 * Why `*` rather than an origin allow-list: this is a public Bearer-token API.
 * Browser apps outside our own app URLs call it directly with an API key
 * (apps/homepage on apps.f3nation.com, and regional F3 websites), and an
 * allow-list would break them. First-party cookie sessions never need CORS:
 * map and admin reach the API through their same-origin /api/orpc proxies,
 * which forward the cookie server-side.
 *
 * Echoing the request origin while also allowing credentials (what this
 * replaced) let any web page act as a signed-in user and read the result.
 *
 * `*` is stamped on every response, including ones to requests with no
 * `Origin` header, and `Vary: Origin` is gone because the answer no longer
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
    request.headers.get(Header.Client) === Client.F3_ME;

  if (isOrpcClient) {
    // Use RPC handler for oRPC client requests
    const { response } = await handler.handle(request, {
      prefix: API_PREFIX_V1,
    });
    return response ?? new Response("Not found", { status: 404 });
  }

  // Use OpenAPI handler for REST-style calls (docs, curl, external clients)
  const { response: openApiResponse } = await openAPIHandler.handle(request, {
    prefix: "/",
  });

  return openApiResponse ?? new Response("Not found", { status: 404 });
}
