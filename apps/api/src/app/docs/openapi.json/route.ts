import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

import { router } from "@acme/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const envBase = process.env.NEXT_PUBLIC_API_URL ?? undefined;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? undefined;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? undefined;
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  const derivedBase = `${proto}://${host}`;
  const baseUrl = (envBase ?? derivedBase).replace(/\/$/, "");

  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  const spec = await generator.generate(router, {
    info: {
      title: "F3 Nation API",
      version: "1.0.0",
      description: "OpenAPI specification generated from oRPC router.",
    },
    servers: [{ url: `${baseUrl}` }],
    security: [{ bearerAuth: [] }],
    // @ts-expect-error -- https://github.com/scalar/scalar/pull/1305
    "x-tagGroups": [
      {
        name: "api",
        tags: [
          "api-key",
          "event",
          "event-type",
          "location",
          "org",
          "ping",
          "request",
          "user",
        ],
      },
      {
        name: "map",
        tags: ["feedback", "map.location"],
      },
    ],
    tags: [
      {
        name: "api-key",
        description: "API key management for programmatic access",
      },
      { name: "event", description: "Workout event management" },
      { name: "event-type", description: "Event type/category management" },
      {
        name: "location",
        description: "Physical location management for workouts",
      },
      {
        name: "org",
        description: "Organization management (regions, AOs, etc.)",
      },
      { name: "ping", description: "Health check endpoints" },
      { name: "request", description: "Data change request workflow" },
      { name: "user", description: "User account management" },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
  });

  return new Response(JSON.stringify(spec), {
    headers: { "Content-Type": "application/json" },
  });
}
