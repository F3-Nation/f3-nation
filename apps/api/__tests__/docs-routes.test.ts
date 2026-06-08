import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiReferenceMock, generateMock } = vi.hoisted(() => ({
  apiReferenceMock: vi.fn(() => () => new Response("openapi-ui")),
  generateMock: vi.fn(async () => ({
    paths: {
      "/v1/ping": {
        get: {},
        post: {},
      },
    },
    components: {},
  })),
}));

vi.mock("@acme/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "https://api.example.com",
  },
}));

vi.mock("@acme/api", () => ({
  router: {},
}));

vi.mock("@scalar/nextjs-api-reference", () => ({
  ApiReference: apiReferenceMock,
}));

vi.mock("@orpc/openapi", () => ({
  OpenAPIGenerator: vi.fn(() => ({
    generate: generateMock,
  })),
}));

vi.mock("@orpc/zod", () => ({
  ZodToJsonSchemaConverter: vi.fn(),
}));

import { GET as getDocs } from "../src/app/docs/route";
import { GET as getOpenApiJson } from "../src/app/docs/openapi.json/route";

describe("docs routes", () => {
  beforeEach(() => {
    apiReferenceMock.mockClear();
  });

  it("renders the API reference page with the configured base URL", async () => {
    const response = await getDocs();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("openapi-ui");
    expect(apiReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/docs/openapi.json",
        baseServerURL: "https://api.example.com",
        pageTitle: "F3 Nation API Reference",
        favicon: "/favicon.ico",
      }),
    );
  });

  it("returns an OpenAPI JSON document with client headers injected", async () => {
    const response = await getOpenApiJson(
      new Request("https://api.example.com/docs/openapi.json"),
    );

    expect(response.status).toBe(200);

    const spec = (await response.json()) as {
      components?: {
        parameters?: Record<string, { name: string; in: string }>;
      };
      paths?: Record<
        string,
        {
          get?: { parameters?: { $ref?: string }[] };
          post?: { parameters?: { $ref?: string }[] };
        }
      >;
    };

    expect(spec.components?.parameters?.ClientHeader).toMatchObject({
      name: "client",
      in: "header",
    });
    expect(spec.paths?.["/v1/ping"]?.get?.parameters?.[0]).toMatchObject({
      $ref: "#/components/parameters/ClientHeader",
    });
    expect(spec.paths?.["/v1/ping"]?.post?.parameters?.[0]).toMatchObject({
      $ref: "#/components/parameters/ClientHeader",
    });

    const generateCalls = generateMock.mock.calls as unknown[][];
    const generateOptions = generateCalls[0]?.[1] as
      | { filter?: (args: { path: string[] }) => boolean }
      | undefined;

    expect(generateOptions?.filter).toBeTypeOf("function");
    expect(generateOptions?.filter?.({ path: ["slack"] })).toBe(false);
    expect(generateOptions?.filter?.({ path: ["ping"] })).toBe(true);
  });
});
