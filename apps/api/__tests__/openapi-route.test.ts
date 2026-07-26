import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

interface GenerateOptions {
  filter: (options: { path: string[] }) => boolean;
  servers: { url: string }[];
}

const generatedProcedures = [
  {
    routerPath: ["ping"],
    openApiPath: "/v1/ping",
    item: {
      get: {
        parameters: [
          { name: "existing", in: "query", schema: { type: "string" } },
        ],
      },
      post: {},
    },
  },
  {
    routerPath: ["slack", "getBotSettingsCache"],
    openApiPath: "/v1/slack/bot/settings/cache",
    item: {
      get: {},
    },
  },
] as const;

const generateMock = vi.fn(
  async (_router: unknown, options: GenerateOptions) => ({
    servers: options.servers,
    paths: Object.fromEntries(
      generatedProcedures
        .filter(({ routerPath }) => options.filter({ path: [...routerPath] }))
        .map(({ openApiPath, item }) => [openApiPath, structuredClone(item)]),
    ),
  }),
);

vi.mock("@acme/api", () => ({
  router: {},
}));

vi.mock("@orpc/zod/zod4", () => ({
  ZodToJsonSchemaConverter: class ZodToJsonSchemaConverter {},
}));

vi.mock("@orpc/openapi", () => ({
  OpenAPIGenerator: class OpenAPIGenerator {
    async generate(...args: Parameters<typeof generateMock>) {
      return generateMock(...args);
    }
  },
}));

describe("docs openapi route", () => {
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

    const { GET } = await import("../src/app/docs/openapi.json/route");

    const response = await GET(
      new Request("https://ignored.example.com/docs/openapi.json"),
    );

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const spec = (await response.json()) as {
      servers: { url: string }[];
      components: { parameters: { ClientHeader: { required: boolean } } };
      paths: {
        "/v1/ping": {
          get: { parameters: { $ref?: string; name?: string }[] };
          post: { parameters: { $ref?: string }[] };
        };
      };
    };

    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0]!.url).toBe("https://api.f3nation.com");
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

    expect(Object.keys(spec.paths)).not.toContain(
      "/v1/slack/bot/settings/cache",
    );
    expect(
      Object.keys(spec.paths).filter((path) =>
        path.endsWith("/bot/settings/cache"),
      ),
    ).toEqual([]);
  });

  it("derives base URL from forwarded headers when env base URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    const { GET } = await import("../src/app/docs/openapi.json/route");

    const response = await GET(
      new Request("http://internal.local/docs/openapi.json", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "api.example.com",
        },
      }),
    );

    const spec = (await response.json()) as { servers: { url: string }[] };
    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0]!.url).toBe("https://api.example.com");
  });
});
