import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";

import type * as HealthModule from "@f3nation/health";
import { healthResponseSchema } from "@f3nation/health";

import { app } from "../src/app";

// Thin wiring tests: prove app.ts routes to the right module and applies the
// legacy-parity behaviors it owns (trailing-slash 308, docs method-guard, no
// compression). Router/auth/dispatch behavior itself is covered by
// handler.ts's own unit tests and the characterization suite, not duplicated
// here.

const { buildHealthResponse } = vi.hoisted(() => ({
  buildHealthResponse: vi.fn(),
}));

const database = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue([]),
  isDbLive: vi.fn().mockReturnValue(true),
  enableDbRecovery: vi.fn(),
}));
vi.mock("@acme/db/client", () => ({
  checkDb: database.execute,
  isDbLive: database.isDbLive,
  enableDbRecovery: database.enableDbRecovery,
}));

vi.mock("@f3nation/health", async (importOriginal) => {
  const actual = await importOriginal<typeof HealthModule>();
  buildHealthResponse.mockImplementation(actual.buildHealthResponse);
  return { ...actual, buildHealthResponse };
});

const { handleRequest } = vi.hoisted(() => ({
  handleRequest: vi.fn((request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/docs`);
    }
    // Large enough that a compression middleware would kick in.
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
    () =>
      new Response(JSON.stringify({ openapi: "3.1.0" }), {
        headers: { "content-type": "application/json" },
      }),
  ),
}));

vi.mock("~/docs-page", () => ({ docsPage }));
vi.mock("~/docs", () => ({ openApiJson }));

const recoveryEnabledAtImport = database.enableDbRecovery.mock.calls.length;

describe("app", () => {
  it("enables database recovery during API initialization", () => {
    expect(recoveryEnabledAtImport).toBe(1);
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    database.execute.mockResolvedValue([]);
    database.isDbLive.mockReturnValue(true);
  });

  it("reports a sanitized critical database failure while retaining HTTP 200", async () => {
    database.execute.mockRejectedValueOnce(
      new Error("private database details"),
    );
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const payload = healthResponseSchema.parse(await res.json());
    expect(payload.status).toBe("down");
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        id: "database",
        status: "down",
        severity: "critical",
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  it("returns memory-only liveness status without querying the database", async () => {
    let res = await app.request("/live");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    database.isDbLive.mockReturnValue(false);
    res = await app.request("/live");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("recovery_failed");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("bounds concurrent health work even after callers time out", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown[]) => void;
    database.execute.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = app.request("/health");
    const second = app.request("/health");
    await vi.advanceTimersByTimeAsync(3_000);
    const responses = await Promise.all([first, second]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(
        healthResponseSchema.parse(await response.json()).checks,
      ).toContainEqual(
        expect.objectContaining({
          id: "database",
          status: "down",
          details: { reason: "timeout", timeoutMs: 3_000 },
        }),
      );
    }
    const third = app.request("/health");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(healthResponseSchema.parse(await (await third).json()).status).toBe(
      "down",
    );
    expect(database.execute).toHaveBeenCalledTimes(1);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
    const recovered = await app.request("/health");
    expect(healthResponseSchema.parse(await recovered.json()).status).toBe(
      "ok",
    );
    expect(database.execute).toHaveBeenCalledTimes(2);
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

  it("returns 204 for OPTIONS and 405 for other verbs on /docs/openapi.json", async () => {
    const preflight = await app.fetch(
      new Request("http://api.test/docs/openapi.json", {
        method: "OPTIONS",
      }),
    );
    expect(preflight.status).toBe(204);

    const wrongVerb = await app.fetch(
      new Request("http://api.test/docs/openapi.json", { method: "POST" }),
    );
    expect(wrongVerb.status).toBe(405);
    expect(wrongVerb.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(openApiJson).not.toHaveBeenCalled();
  });

  it("allows HEAD requests through the docs method guard", async () => {
    const docsHead = await app.fetch(
      new Request("http://api.test/docs", { method: "HEAD" }),
    );
    expect(docsHead.status).not.toBe(405);

    const openApiHead = await app.fetch(
      new Request("http://api.test/docs/openapi.json", { method: "HEAD" }),
    );
    expect(openApiHead.status).not.toBe(405);
  });

  it("serves the favicon", async () => {
    const res = await app.fetch(new Request("http://api.test/favicon.ico"));

    expect(res.status).toBe(200);
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

  it("never compresses, even when the client accepts gzip", async () => {
    const res = await app.fetch(
      new Request("http://api.test/v1/some-large-endpoint", {
        headers: { "accept-encoding": "gzip, br" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
    expect(await res.text()).toBe("x".repeat(2000));
  });

  it("returns a generic 500 when a handler throws an ordinary error", async () => {
    handleRequest.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const res = await app.fetch(new Request("http://api.test/v1/throws"));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
  });

  it("passes a thrown HTTPException's own response through instead of flattening it", async () => {
    handleRequest.mockImplementationOnce(() => {
      throw new HTTPException(418, { message: "teapot" });
    });

    const res = await app.fetch(new Request("http://api.test/v1/teapot"));

    expect(res.status).toBe(418);
  });
  describe("security headers", () => {
    const expected = {
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
    };

    function expectSecurityHeaders(res: Response) {
      for (const [name, value] of Object.entries(expected)) {
        expect(res.headers.get(name)).toBe(value);
      }
      expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
    }

    it.each([
      ["a handler response", "http://api.test/health"],
      ["a page", "http://api.test/docs"],
      ["a catch-all response", "http://api.test/v1/some-endpoint"],
      ["an immutable Response.redirect()", "http://api.test/"],
      ["the trailing-slash 308", "http://api.test/v1/ping/"],
    ])("is set on %s", async (_label, url) => {
      expectSecurityHeaders(await app.fetch(new Request(url)));
    });

    // Guards the 500 path: Hono's compose catches the throw at the dispatch
    // level and runs onError, so the security middleware's post-`next()` code
    // still runs. See the comment above the middleware in src/app.ts.
    it("is set on an unhandled-error 500", async () => {
      handleRequest.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const res = await app.fetch(new Request("http://api.test/v1/throws"));

      expect(res.status).toBe(500);
      expectSecurityHeaders(res);
    });

    it("keeps the handler's own headers and body", async () => {
      const res = await app.fetch(new Request("http://api.test/health"));

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("application/json");
      expect((await res.json()) as unknown).toHaveProperty("service", "f3-api");
    });
  });
});
