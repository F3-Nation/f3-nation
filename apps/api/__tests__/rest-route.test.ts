import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as OrpcServer from "@orpc/server";
import type { StandardHandlerInterceptorOptions } from "@orpc/server/standard";

import { Client, Header } from "@acme/shared/common/enums";

// Hoisted mocks shared between the vi.mock factories and the test bodies.
const {
  rpcHandle,
  openApiHandle,
  rpcCtor,
  openApiCtor,
  corsCtor,
  logError,
  logWarn,
} = vi.hoisted(() => ({
  rpcHandle: vi.fn<(...args: unknown[]) => Promise<{ response?: Response }>>(),
  openApiHandle:
    vi.fn<(...args: unknown[]) => Promise<{ response?: Response }>>(),
  rpcCtor: vi.fn(),
  openApiCtor: vi.fn(),
  corsCtor: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@acme/api", () => ({ router: {} }));
vi.mock("~/lib/logging", () => ({ logError, logWarn }));

vi.mock("@orpc/server", async (importOriginal) => ({
  // The real ORPCError, so the 4xx/5xx split is tested against oRPC's own
  // status mapping.
  ...(await importOriginal<typeof OrpcServer>()),
  // Pass the error callback straight through so we can invoke it directly.
  onError: (fn: unknown) => fn,
}));

vi.mock("@orpc/server/plugins", () => ({
  CORSPlugin: class CORSPlugin {
    constructor(options: unknown) {
      corsCtor(options);
    }
  },
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

// Derived from oRPC's own exported type (not hand-rolled) so a future change
// to StandardLazyRequest's shape is caught here instead of silently drifting.
// Picked down to just the fields this suite reads, rather than the full
// StandardLazyRequest (which also requires headers/body/signal).
type InterceptorRequest = Pick<
  StandardHandlerInterceptorOptions<never>["request"],
  "url" | "method"
>;

interface Interceptors {
  interceptors: ((
    error: unknown,
    options: { request: InterceptorRequest },
  ) => void)[];
}

const importHandler = () => import("../src/handler");

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

describe("handleRequest", () => {
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
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
        new Request("https://ignored.example.com/"),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "https://api.f3nation.com/docs",
      );
      expect(rpcHandle).not.toHaveBeenCalled();
      expect(openApiHandle).not.toHaveBeenCalled();
    });

    it("derives the base URL from forwarded headers when env is unset", async () => {
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
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
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
        new Request("http://localhost:3001/"),
      );

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
        const { handleRequest } = await importHandler();

        const response = await handleRequest(
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
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
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
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
        new Request("https://api.example.com/v1/events"),
      );

      expect(openApiHandle).toHaveBeenCalledTimes(1);
      expect(rpcHandle).not.toHaveBeenCalled();
      expect(response).toBe(restResponse);
    });

    it("returns 404 when the OpenAPI handler produces no response", async () => {
      openApiHandle.mockResolvedValue({ response: undefined });
      const { handleRequest } = await importHandler();

      const response = await handleRequest(
        new Request("https://api.example.com/v1/events"),
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    });
  });

  it("reflects the request origin in CORS (credentialed requests forbid *)", async () => {
    await importHandler();

    const { origin, credentials } = corsCtor.mock.calls[0]![0] as {
      origin: (origin: string) => string;
      credentials: boolean;
    };
    expect(credentials).toBe(true);
    expect(origin("https://map.f3nation.com")).toBe("https://map.f3nation.com");
  });

  describe("error interceptors log via logError", () => {
    it("logs RPC and OpenAPI handler errors with distinct events", async () => {
      await importHandler();

      const rpcOptions = rpcCtor.mock.calls[0]![1] as Interceptors;
      const openApiOptions = openApiCtor.mock.calls[0]![1] as Interceptors;

      const rpcError = new Error("rpc boom");
      rpcOptions.interceptors[0]!(rpcError, {
        request: {
          url: new URL("http://api.test/v1/rpc-path"),
          method: "POST",
        },
      });
      expect(logError).toHaveBeenCalledWith(
        "api.rpc.handler_error",
        { path: "/v1/rpc-path", method: "POST" },
        rpcError,
      );

      const openApiError = new Error("openapi boom");
      openApiOptions.interceptors[0]!(openApiError, {
        request: {
          url: new URL("http://api.test/v1/openapi-path"),
          method: "GET",
        },
      });
      expect(logError).toHaveBeenCalledWith(
        "api.openapi.handler_error",
        { path: "/v1/openapi-path", method: "GET" },
        openApiError,
      );
    });

    it("logs 4xx ORPCErrors at warn so they never reach the error tracker", async () => {
      const { ORPCError } = await import("@orpc/server");
      await importHandler();
      const rpcOptions = rpcCtor.mock.calls[0]![1] as Interceptors;
      const request = {
        url: new URL("http://api.test/v1/rpc-path"),
        method: "POST",
      };

      for (const [code, status, message] of [
        ["TOO_MANY_REQUESTS", 429, "Rate limit exceeded. Try again in 1s"],
        ["UNAUTHORIZED", 401, "Unauthorized"],
        ["BAD_REQUEST", 400, "Input validation failed"],
      ] as const) {
        rpcOptions.interceptors[0]!(new ORPCError(code, { message }), {
          request,
        });
        expect(logWarn).toHaveBeenLastCalledWith("api.rpc.handler_error", {
          path: "/v1/rpc-path",
          method: "POST",
          status,
          code,
        });
        // Never the message — client-facing messages can echo user input.
        expect(JSON.stringify(logWarn.mock.lastCall)).not.toContain(message);
      }
      expect(logError).not.toHaveBeenCalled();
    });

    it("still logs 5xx ORPCErrors via logError", async () => {
      const { ORPCError } = await import("@orpc/server");
      await importHandler();
      const rpcOptions = rpcCtor.mock.calls[0]![1] as Interceptors;

      const serverError = new ORPCError("INTERNAL_SERVER_ERROR");
      rpcOptions.interceptors[0]!(serverError, {
        request: { url: new URL("http://api.test/v1/x"), method: "GET" },
      });
      expect(logError).toHaveBeenCalledWith(
        "api.rpc.handler_error",
        { path: "/v1/x", method: "GET" },
        serverError,
      );
      expect(logWarn).not.toHaveBeenCalled();
    });
  });
});
