import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

import { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";

// OpenAPI types for spec manipulation
interface OpenAPIParameter {
  name: string;
  in: string;
  required?: boolean;
  schema: { type: string; default?: string };
  description?: string;
}

interface OpenAPIOperation {
  parameters?: OpenAPIParameter[];
  [key: string]: unknown;
}

interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  options?: OpenAPIOperation;
  head?: OpenAPIOperation;
  [key: string]: unknown;
}

interface OpenAPISpec {
  paths?: Record<string, OpenAPIPathItem>;
  components?: {
    parameters?: Record<string, OpenAPIParameter>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

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

  const spec = (await generator.generate(router, {
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
        name: "slack",
        tags: ["slack"],
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
      { name: "slack", description: "Slack integration and management" },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      parameters: {
        ClientHeader: {
          name: Header.Client,
          in: "header",
          required: false,
          schema: { type: "string", default: Client.SCALAR_API },
          description:
            "Client identifier for API requests. Required for all endpoints.",
        },
      },
    },
  })) as OpenAPISpec;

  // Add Client header parameter to components
  const clientHeaderParam: OpenAPIParameter = {
    name: Header.Client,
    in: "header",
    required: true,
    schema: {
      type: "string",
      default: Client.SCALAR_API,
    },
    description:
      "Client identifier for API requests. Required for all endpoints.",
  };

  // Ensure components.parameters exists
  if (!spec.components) {
    spec.components = {};
  }
  if (!spec.components.parameters) {
    spec.components.parameters = {};
  }
  spec.components.parameters.ClientHeader = clientHeaderParam;

  // Add the Client header parameter reference to all operations
  const httpMethods = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
  ] as const;

  if (spec.paths) {
    for (const pathItem of Object.values(spec.paths)) {
      for (const method of httpMethods) {
        const operation = pathItem[method];
        if (operation) {
          if (!operation.parameters) {
            operation.parameters = [];
          }
          // Add reference to the Client header parameter
          operation.parameters.unshift({
            $ref: "#/components/parameters/ClientHeader",
          } as unknown as OpenAPIParameter);
        }
      }
    }
  }

  return new Response(JSON.stringify(spec), {
    headers: { "Content-Type": "application/json" },
  });
}
