import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@acme/api", () => ({
  router: {},
}));

vi.mock("@orpc/zod/zod4", () => ({
  ZodToJsonSchemaConverter: class ZodToJsonSchemaConverter {},
}));

vi.mock("@orpc/openapi", () => ({
  OpenAPIGenerator: class OpenAPIGenerator {
    async generate(...args: unknown[]) {
      return generateMock(...args);
    }
  },
}));

describe("docs openapi route", () => {
  const getGenerateOptions = () => {
    const firstCall = generateMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected OpenAPIGenerator.generate to be called");
    }

    return firstCall[1] as {
      servers: { url: string }[];
    };
  };

  const originalNextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_API_URL = "";
  });

  afterAll(() => {
    if (originalNextPublicApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
      return;
    }
    process.env.NEXT_PUBLIC_API_URL = originalNextPublicApiUrl;
  });

  it("uses NEXT_PUBLIC_API_URL when set and injects ClientHeader for operations", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.f3nation.com/";

    generateMock.mockResolvedValue({
      paths: {
        "/v1/ping": {
          get: {
            parameters: [
              { name: "existing", in: "query", schema: { type: "string" } },
            ],
          },
          post: {},
        },
      },
    });

    const { GET } = await import("../src/app/docs/openapi.json/route");

    const response = await GET(
      new Request("https://ignored.example.com/docs/openapi.json"),
    );

    expect(generateMock).toHaveBeenCalledTimes(1);
    const generateOptions = getGenerateOptions();
    expect(generateOptions.servers).toHaveLength(1);
    expect(generateOptions.servers[0]!.url).toBe("https://api.f3nation.com");

    expect(response.headers.get("Content-Type")).toContain("application/json");
    const spec = (await response.json()) as {
      components: { parameters: { ClientHeader: { required: boolean } } };
      paths: {
        "/v1/ping": {
          get: { parameters: { $ref?: string; name?: string }[] };
          post: { parameters: { $ref?: string }[] };
        };
      };
    };

    expect(spec.components.parameters.ClientHeader.required).toBe(true);
    expect(spec.paths["/v1/ping"].get.parameters).toHaveLength(2);
    expect(spec.paths["/v1/ping"].post.parameters).toHaveLength(1);
    expect(spec.paths["/v1/ping"].get.parameters[0]!.$ref).toBe(
      "#/components/parameters/ClientHeader",
    );
    expect(spec.paths["/v1/ping"].get.parameters[1]!.name).toBe("existing");
    expect(spec.paths["/v1/ping"].post.parameters[0]!.$ref).toBe(
      "#/components/parameters/ClientHeader",
    );
  });

  it("derives base URL from forwarded headers when env base URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    generateMock.mockResolvedValue({
      paths: {
        "/v1/events": {
          get: {},
        },
      },
    });

    const { GET } = await import("../src/app/docs/openapi.json/route");

    await GET(
      new Request("http://internal.local/docs/openapi.json", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "api.example.com",
        },
      }),
    );

    const generateOptions = getGenerateOptions();
    expect(generateOptions.servers).toHaveLength(1);
    expect(generateOptions.servers[0]!.url).toBe("https://api.example.com");
  });
});
