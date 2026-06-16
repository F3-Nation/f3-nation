import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

// Hoisted mocks shared between the vi.mock factories and the test bodies.
const { rpcHandle, openApiHandle, rpcCtor, openApiCtor, logError } = vi.hoisted(
  () => ({
    rpcHandle:
      vi.fn<(...args: unknown[]) => Promise<{ response?: Response }>>(),
    openApiHandle:
      vi.fn<(...args: unknown[]) => Promise<{ response?: Response }>>(),
    rpcCtor: vi.fn(),
    openApiCtor: vi.fn(),
    logError: vi.fn(),
  }),
);

vi.mock("@acme/api", () => ({ router: {} }));
vi.mock("~/lib/logging", () => ({ logError }));

vi.mock("@orpc/server", () => ({
  // Pass the error callback straight through so we can invoke it directly.
  onError: (fn: unknown) => fn,
}));

vi.mock("@orpc/server/plugins", () => ({
  CORSPlugin: class CORSPlugin {},
  RequestHeadersPlugin: class RequestHeadersPlugin {},
}));

vi.mock("@orpc/server/fetch", () => ({
  RPCHandler: class RPCHandler {
    handle = rpcHandle;
    constructor(router: unknown, options: unknown) {
      rpcCtor(router, options);
    }
  },
}));

vi.mock("@orpc/openapi/fetch", () => ({
  OpenAPIHandler: class OpenAPIHandler {
    handle = openApiHandle;
    constructor(router: unknown, options: unknown) {
      openApiCtor(router, options);
    }
  },
}));

interface Interceptors {
  interceptors: ((error: unknown) => void)[];
}

const importRoute = () => import("../src/app/[[...rest]]/route");

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

describe("[[...rest]] catch-all route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rpcHandle.mockResolvedValue({ response: new Response("rpc") });
    openApiHandle.mockResolvedValue({ response: new Response("rest") });
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  describe("root redirect to /docs", () => {
    it("uses NEXT_PUBLIC_API_URL (trailing slash stripped) when set", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.f3nation.com/";
      const { GET } = await importRoute();

      const response = await GET(new Request("https://ignored.example.com/"));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "https://api.f3nation.com/docs",
      );
      expect(rpcHandle).not.toHaveBeenCalled();
      expect(openApiHandle).not.toHaveBeenCalled();
    });

    it("derives the base URL from forwarded headers when env is unset", async () => {
      const { GET } = await importRoute();

      const response = await GET(
        new Request("http://internal.local/", {
          headers: {
            "x-forwarded-proto": "https",
            "x-forwarded-host": "fwd.example.com",
          },
        }),
      );

      expect(response.headers.get("location")).toBe(
        "https://fwd.example.com/docs",
      );
    });

    it("falls back to the request URL host when no forwarded headers exist", async () => {
      const { GET } = await importRoute();

      const response = await GET(new Request("http://localhost:3001/"));

      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/docs",
      );
    });
  });

  describe("oRPC client requests use the RPC handler", () => {
    it.each([Client.ORPC, Client.ORPC_SSG, Client.F3_ME])(
      "routes the %s client header to the RPC handler",
      async (client) => {
        const rpcResponse = new Response("rpc-ok");
        rpcHandle.mockResolvedValue({ response: rpcResponse });
        const { POST } = await importRoute();

        const response = await POST(
          new Request("https://api.example.com/v1/ping", {
            method: "POST",
            headers: { [Header.Client]: client },
          }),
        );

        expect(rpcHandle).toHaveBeenCalledTimes(1);
        expect(openApiHandle).not.toHaveBeenCalled();
        expect(response).toBe(rpcResponse);
      },
    );

    it("returns 404 when the RPC handler produces no response", async () => {
      rpcHandle.mockResolvedValue({ response: undefined });
      const { GET } = await importRoute();

      const response = await GET(
        new Request("https://api.example.com/v1/ping", {
          headers: { [Header.Client]: Client.ORPC },
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    });
  });

  describe("non-oRPC requests use the OpenAPI handler", () => {
    it("routes REST-style calls to the OpenAPI handler", async () => {
      const restResponse = new Response("rest-ok");
      openApiHandle.mockResolvedValue({ response: restResponse });
      const { GET } = await importRoute();

      const response = await GET(
        new Request("https://api.example.com/v1/events"),
      );

      expect(openApiHandle).toHaveBeenCalledTimes(1);
      expect(rpcHandle).not.toHaveBeenCalled();
      expect(response).toBe(restResponse);
    });

    it("returns 404 when the OpenAPI handler produces no response", async () => {
      openApiHandle.mockResolvedValue({ response: undefined });
      const { GET } = await importRoute();

      const response = await GET(
        new Request("https://api.example.com/v1/events"),
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    });
  });

  describe("error interceptors log via logError", () => {
    it("logs RPC and OpenAPI handler errors with distinct events", async () => {
      await importRoute();

      const rpcOptions = rpcCtor.mock.calls[0]![1] as Interceptors;
      const openApiOptions = openApiCtor.mock.calls[0]![1] as Interceptors;

      const rpcError = new Error("rpc boom");
      rpcOptions.interceptors[0]!(rpcError);
      expect(logError).toHaveBeenCalledWith(
        "api.rpc.handler_error",
        {},
        rpcError,
      );

      const openApiError = new Error("openapi boom");
      openApiOptions.interceptors[0]!(openApiError);
      expect(logError).toHaveBeenCalledWith(
        "api.openapi.handler_error",
        {},
        openApiError,
      );
    });
  });

  describe("HTTP method exports", () => {
    it("wires every method alias to the same handler", async () => {
      const route = await importRoute();

      expect(route.GET).toBe(route.HEAD);
      expect(route.GET).toBe(route.POST);
      expect(route.GET).toBe(route.PUT);
      expect(route.GET).toBe(route.PATCH);
      expect(route.GET).toBe(route.DELETE);
      expect(route.GET).toBe(route.OPTIONS);
    });
  });
});
