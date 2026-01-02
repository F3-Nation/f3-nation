import { OpenAPIHandler } from "@orpc/openapi/fetch"; // or '@orpc/server/node'
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin, RequestHeadersPlugin } from "@orpc/server/plugins";

import { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { Client, Header } from "@acme/shared/common/enums";

const corsPlugin = new CORSPlugin({
  origin: (origin) => {
    const allowedOrigins = [];
    if (isProductionNodeEnv) {
      if (origin.endsWith(".f3nation.com")) {
        allowedOrigins.push(origin);
      }
    } else {
      if (origin.endsWith(".f3nation.test")) {
        allowedOrigins.push(origin);
      }
      allowedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");
    }

    return allowedOrigins;
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: [Header.ContentType, Header.Authorization, Header.Client],
  maxAge: 600,
  credentials: true,
});

const handler = new RPCHandler(router, {
  plugins: [corsPlugin, new RequestHeadersPlugin()],
  interceptors: [
    onError((error) => {
      const typedError = error as { message?: string; stack?: string };
      console.error("RPC handler error", {
        error,
        message: typedError?.message,
        stack: typedError?.stack,
      });
    }),
  ],
});

const openAPIHandler = new OpenAPIHandler(router, {
  plugins: [corsPlugin, new RequestHeadersPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

async function handleRequest(request: Request) {
  // Redirect to /docs if the request is for /
  if (new URL(request.url).pathname === "/") {
    const envBase = process.env.NEXT_PUBLIC_API_URL ?? undefined;
    const forwardedProto =
      request.headers.get("x-forwarded-proto") ?? undefined;
    const forwardedHost = request.headers.get("x-forwarded-host") ?? undefined;
    const url = new URL(request.url);
    const host = forwardedHost ?? request.headers.get("host") ?? url.host;
    const proto = forwardedProto ?? url.protocol.replace(":", "");
    const derivedBase = `${proto}://${host}`;
    const baseUrl = (envBase ?? derivedBase).replace(/\/$/, "");
    return Response.redirect(`${baseUrl}/docs`);
  }

  // Check if this is an oRPC client request (from the map app)
  // oRPC client sends a custom header to identify itself
  const isOrpcClient =
    request.headers.get(Header.Client) === Client.ORPC ||
    request.headers.get(Header.Client) === Client.ORPC_SSG;

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

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest; // Important for CORS preflight!
