import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";
import packageJson from "../../../../package.json";

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
    filter: ({ path }) =>
      !path.includes("slack") || !path.includes("getBotSettingsCache"),
    info: {
      title: "F3 Nation API",
      version: packageJson.version,
      description: `# Authentication

All API endpoints require authentication via a Bearer token passed in the Authorization header.

## Required Headers

Every request must include the following headers:

### 1. Authorization Header (Required)
\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

The Bearer token is an API key that represents programmatic access to the F3 Nation API. This key must be a valid, non-revoked API key that has not expired.

### 2. Client Header (Required)
\`\`\`
Client: your-app-identifier
\`\`\`

The \`Client\` header must be present and contain a string that identifies your application or service. This helps us track API usage and troubleshoot issues. Examples: \`https://f3milwaukee.com/locations\`, \`gloom-scheduler\`, \`Tackles Postman\`, etc.

## Getting Started

### Step 1: Generate an API Key
Navigate to **https://map.f3nation.com/admin/api-keys** if you are an admin on a specific region or the F3 Nation organization. You can:
- Create new API keys
- Set expiration dates for security
- View and revoke keys

### Step 2: Configure Your Client
Use the generated API key and a descriptive client identifier in your application:

\`\`\`bash
curl -X GET "https://api.f3nation.com/v1/ping" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Client: my-app"
\`\`\`

### Step 3: Make API Calls
Include both headers in every request to the F3 Nation API.

## Role-Based Access

API keys inherit the roles and permissions of their owner. Access levels include:

- **Editor**: Can view and modify data within assigned organizations
- **Admin**: Same permissions as Editor, plus the ability to add/remove other Admins and Editors

As of February 1, 2026, regional admins can only create read-only API keys. If you want an API Key edit access to your region, you will need to contact an F3 Nation admin. Right now, regional edit access is highly restrcited. This is because the API is still new and there are almost certainly gaps in security - meaning that a region has the potential to mess up data for other regions.

## Best Practices

1. **Keep Keys Secure**: Never commit API keys to version control. Use environment variables instead.
    a. Read-Only keys are an exception. We realize many regions use systems that require storing the key in a config file or in plain text on the front-end. Read-Only keys are much less risky to expose.
2. **Use Expiration Dates**: Set expiration dates on keys to limit exposure window in case of compromise.

## Error Handling

- **401 Unauthorized**: Missing, invalid, revoked, or expired API key
- **403 Forbidden**: Valid API key but insufficient permissions for the requested resource
- **429 Too Many Requests**: Rate limit exceeded (200 requests per 60 seconds)`,
      contact: {
        name: "F3 Nation",
        url: "https://f3nation.com",
      },
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
          "event-instance",
          "event-type",
          "event-tag",
          "attendance",
          "location",
          "org",
          "ping",
          "position",
          "request",
          "user",
        ],
      },
      {
        name: "map",
        tags: ["feedback", "map.event", "map.location", "revalidate"],
      },
      {
        name: "Org Chart",
        tags: ["Org Chart"],
      },
      {
        name: "Me",
        tags: ["Me"],
      },
      {
        name: "Slack",
        tags: ["slack"],
      },
    ],
    tags: [
      {
        name: "api-key",
        description: "API key management for programmatic access",
      },
      { name: "event", description: "Workout event management" },
      {
        name: "event-instance",
        description: "Specific occurrences of workout events",
      },
      { name: "event-type", description: "Event type/category management" },
      {
        name: "event-tag",
        description: "Event tag management for categorization",
      },
      { name: "attendance", description: "Attendance management for events" },
      {
        name: "location",
        description: "Physical location management for workouts",
      },
      {
        name: "Me",
        description:
          "Used by the F3 Me app to allow authenticated users to manage their profile",
      },
      {
        name: "org",
        description: "Organization management (regions, AOs, etc.)",
      },
      {
        name: "Org Chart",
        description: "Organization chart data and leadership",
      },
      { name: "ping", description: "Health check endpoints" },
      {
        name: "position",
        description: "Position and role management for organizations",
      },
      { name: "request", description: "Data change request workflow" },
      { name: "user", description: "User account management" },
      {
        name: "map.event",
        description: "Map event/workout endpoints for filtering and querying",
      },
      { name: "revalidate", description: "Cache revalidation for map data" },
      {
        name: "slack",
        description:
          "Slack and F3 Nation Slack app integration endpoints for managing content",
      },
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
      "Client identifier for API requests. A string that identifies your application or service (e.g., 'https://f3milewaukee.com/location', 'gloom-scheduler', 'Tackles Postaman'). Required for all endpoints.",
  };

  // Ensure components.parameters exists
  spec.components ??= {};
  spec.components.parameters ??= {};
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
          operation.parameters ??= [];
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
