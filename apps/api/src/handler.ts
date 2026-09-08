import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin, RequestHeadersPlugin } from "@orpc/server/plugins";

import { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { getBaseUrl } from "~/lib/get-base-url";
import { logError } from "~/lib/logging";

const corsPlugin = new CORSPlugin({
  origin: (origin) => origin,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: [Header.ContentType, Header.Authorization, Header.Client],
  maxAge: 600,
  credentials: true,
});

const handler = new RPCHandler(router, {
  plugins: [corsPlugin, new RequestHeadersPlugin()],
  interceptors: [
    onError((error, { request }) => {
      logError(
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
      logError(
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
