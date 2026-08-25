import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as HealthModule from "@f3nation/health";
import { healthResponseSchema } from "@f3nation/health";

import { app } from "../src/app";

// Thin wiring tests: prove app.ts routes to the right module and applies the
// Next-parity behaviors it owns (trailing-slash 308, docs method-guard,
// compression). Router/auth/dispatch behavior itself is covered by
// handler.ts's own unit tests and the characterization suite, not duplicated
// here.

const { buildHealthResponse } = vi.hoisted(() => ({
  buildHealthResponse: vi.fn(),
}));

vi.mock("@f3nation/health", async (importOriginal) => {
  const actual = await importOriginal<typeof HealthModule>();
  buildHealthResponse.mockImplementation(actual.buildHealthResponse);
  return { ...actual, buildHealthResponse };
});

const { handleRequest } = vi.hoisted(() => ({
  handleRequest: vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/docs`);
    }
    // Body over hono/compress's 1024-byte default threshold.
    return new Response("x".repeat(2000), {
      headers: { "content-type": "text/plain" },
    });
  }),
}));

vi.mock("~/handler", () => ({ handleRequest }));

const { docsPage, openApiJson } = vi.hoisted(() => ({
  docsPage: vi.fn(
    () =>
      new Response("<html><body>F3 Nation API Reference</body></html>", {
        headers: { "content-type": "text/html" },
      }),
  ),
  openApiJson: vi.fn(
    async () =>
      new Response(JSON.stringify({ openapi: "3.1.0" }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}));

vi.mock("~/docs-page", () => ({ docsPage }));
vi.mock("~/docs", () => ({ openApiJson }));

describe("app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a contract-valid /health response", async () => {
    const res = await app.fetch(new Request("http://api.test/health"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const parsed = healthResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.service).toBe("f3-api");
      expect(parsed.data.status).toBe("ok");
    }
  });

  it("still returns a contract-valid 200 if the health machinery itself throws", async () => {
    buildHealthResponse.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const res = await app.fetch(new Request("http://api.test/health"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const parsed = healthResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("down");
      expect(parsed.data.checks[0]?.id).toBe("health-endpoint");
    }
  });

  it("serves /docs via the Scalar handler", async () => {
    const res = await app.fetch(new Request("http://api.test/docs"));

    expect(res.status).toBe(200);
    expect(docsPage).toHaveBeenCalledTimes(1);
  });

  it("returns 204 for OPTIONS and 405 for other verbs on /docs", async () => {
    const preflight = await app.fetch(
      new Request("http://api.test/docs", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);

    const wrongVerb = await app.fetch(
      new Request("http://api.test/docs", { method: "POST" }),
    );
    expect(wrongVerb.status).toBe(405);
    expect(wrongVerb.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(docsPage).not.toHaveBeenCalled();
  });

  it("serves /docs/openapi.json via the OpenAPI generator", async () => {
    const res = await app.fetch(
      new Request("http://api.test/docs/openapi.json"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(openApiJson).toHaveBeenCalledTimes(1);
  });

  it("redirects / via the catch-all dispatching to handleRequest", async () => {
    const res = await app.fetch(new Request("http://api.test/"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://api.test/docs");
  });

  it("redirects a trailing-slash path with 308 before any route matches", async () => {
    const res = await app.fetch(
      new Request("http://api.test/v1/ping/?foo=bar"),
    );

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/v1/ping?foo=bar");
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["//evil.com/", "/evil.com"],
    ["//", "/"],
    ["/a//", "/a"],
  ])(
    "strips leading slashes from %s so the redirect can't become protocol-relative",
    async (path, expectedLocation) => {
      const res = await app.fetch(
        new Request(`http://api.test${path}`, { redirect: "manual" }),
      );

      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(expectedLocation);
    },
  );

  it("compresses a large catch-all response when the client accepts gzip", async () => {
    const res = await app.fetch(
      new Request("http://api.test/v1/some-large-endpoint", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  it("does not compress a body under the 1024-byte threshold", async () => {
    handleRequest.mockImplementationOnce(
      async () => new Response("small body"),
    );

    const res = await app.fetch(
      new Request("http://api.test/v1/small-endpoint", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("does not compress when the client sends no Accept-Encoding header", async () => {
    const res = await app.fetch(
      new Request("http://api.test/v1/some-large-endpoint"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("leaves a response that already sets content-length alone", async () => {
    const body = "x".repeat(2000);
    handleRequest.mockImplementationOnce(
      async () =>
        new Response(body, {
          headers: { "content-length": String(body.length) },
        }),
    );

    const res = await app.fetch(
      new Request("http://api.test/v1/precomputed-length", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  it("leaves a response that already sets content-encoding alone", async () => {
    handleRequest.mockImplementationOnce(
      async () =>
        new Response("x".repeat(2000), {
          headers: { "content-encoding": "identity" },
        }),
    );

    const res = await app.fetch(
      new Request("http://api.test/v1/precompressed", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("identity");
  });
});
