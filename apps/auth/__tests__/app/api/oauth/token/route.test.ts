import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/oauth", () => ({
  exchangeAuthorizationCode: vi.fn(),
  exchangeRefreshToken: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  getCorsHeaders: vi.fn(async () => ({
    "Access-Control-Allow-Origin": "https://example.com",
  })),
  handlePreflight: vi.fn(
    (headers: Record<string, string>) =>
      new Response(null, { status: 204, headers }),
  ),
}));
vi.mock("~/lib/logging", () => ({
  logError: vi.fn(),
}));
vi.mock("~/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 59 })),
}));
const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/better-auth-oauth", () => ({ forwardToBetterAuth: vi.fn() }));

const { exchangeAuthorizationCode, exchangeRefreshToken } =
  await import("~/lib/oauth");
const { getCorsHeaders, handlePreflight } = await import("~/lib/cors");
const { logError } = await import("~/lib/logging");
const { rateLimit } = await import("~/lib/rate-limit");
const { forwardToBetterAuth } = await import("~/lib/better-auth-oauth");
const { OPTIONS, POST } =
  await import("../../../../../src/app/api/oauth/token/route");

// route.ts only ever calls request.headers.get(...) and request.formData() —
// a minimal fake satisfying that shape avoids depending on Next.js's own
// NextRequest runtime behavior, which this route never touches.
function makeRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): NextRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return {
    headers: new Headers(headers),
    formData: async () => formData,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
  vi.mocked(getCorsHeaders).mockResolvedValue({
    "Access-Control-Allow-Origin": "https://example.com",
  });
  vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 59 });
});

describe("OPTIONS", () => {
  it("returns a CORS preflight response", async () => {
    const req = makeRequest({}, { origin: "https://example.com" });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(getCorsHeaders).toHaveBeenCalledWith(req);
    expect(handlePreflight).toHaveBeenCalledWith({
      "Access-Control-Allow-Origin": "https://example.com",
    });
  });
});

describe("POST", () => {
  it("never reaches Better Auth while the flag is off", async () => {
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
      error: "invalid_grant",
    });
    await POST(
      makeRequest({
        grant_type: "authorization_code",
        client_id: "some-client",
        code: "abc",
        redirect_uri: "https://example.com/callback",
      }),
    );
    expect(exchangeAuthorizationCode).toHaveBeenCalled();
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });

  it("rejects a request with no client_id and no Basic auth header", async () => {
    const req = makeRequest({ grant_type: "authorization_code" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_request",
      error_description: "Missing client_id",
    });
  });

  it("resolves client_id/client_secret from a Basic auth header when absent from the body", async () => {
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
      access_token: "at",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "rt",
      scope: "openid",
    });
    const basic = Buffer.from("basic-client:basic-secret").toString("base64");
    const req = makeRequest(
      {
        grant_type: "authorization_code",
        code: "abc",
        redirect_uri: "https://example.com/callback",
      },
      { authorization: `Basic ${basic}` },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "basic-client",
        clientSecret: "basic-secret",
      }),
    );
  });

  it("returns 429 when the client is rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0 });
    const req = makeRequest({
      grant_type: "authorization_code",
      client_id: "some-client",
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limit_exceeded" });
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  describe("authorization_code grant", () => {
    it("rejects when code or redirect_uri is missing", async () => {
      const req = makeRequest({
        grant_type: "authorization_code",
        client_id: "some-client",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it("exchanges a valid code and returns the token payload with CORS headers", async () => {
      vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
        access_token: "at",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt",
        scope: "openid",
      });
      const req = makeRequest({
        grant_type: "authorization_code",
        client_id: "some-client",
        client_secret: "some-secret",
        code: "abc",
        redirect_uri: "https://example.com/callback",
        code_verifier: "verifier",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(await res.json()).toMatchObject({ access_token: "at" });
      expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: "abc",
        clientId: "some-client",
        clientSecret: "some-secret",
        redirectUri: "https://example.com/callback",
        codeVerifier: "verifier",
      });
    });

    it("passes through a rejection from exchangeAuthorizationCode as a 400", async () => {
      vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
        error: "invalid_grant",
      });
      const req = makeRequest({
        grant_type: "authorization_code",
        client_id: "some-client",
        code: "abc",
        redirect_uri: "https://example.com/callback",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_grant" });
    });
  });

  describe("refresh_token grant", () => {
    it("rejects when refresh_token is missing", async () => {
      const req = makeRequest({
        grant_type: "refresh_token",
        client_id: "some-client",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it("exchanges a valid refresh token and returns the token payload", async () => {
      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        access_token: "at2",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt2",
        scope: "openid",
      });
      const req = makeRequest({
        grant_type: "refresh_token",
        client_id: "some-client",
        client_secret: "some-secret",
        refresh_token: "old-rt",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ access_token: "at2" });
      expect(exchangeRefreshToken).toHaveBeenCalledWith({
        refreshToken: "old-rt",
        clientId: "some-client",
        clientSecret: "some-secret",
      });
    });

    it("passes through a rejection from exchangeRefreshToken as a 400", async () => {
      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        error: "invalid_grant",
      });
      const req = makeRequest({
        grant_type: "refresh_token",
        client_id: "some-client",
        refresh_token: "old-rt",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "invalid_grant",
      });
    });
  });

  it("rejects an unsupported grant_type", async () => {
    const req = makeRequest({
      grant_type: "client_credentials",
      client_id: "some-client",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported_grant_type" });
  });

  it("returns a 500 server_error and logs when the exchange throws", async () => {
    vi.mocked(exchangeAuthorizationCode).mockRejectedValue(
      new Error("db unavailable"),
    );
    const req = makeRequest({
      grant_type: "authorization_code",
      client_id: "some-client",
      code: "abc",
      redirect_uri: "https://example.com/callback",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(logError).toHaveBeenCalledWith(
      "auth.oauth.token_endpoint_error",
      { grantType: "authorization_code", clientId: "some-client" },
      expect.any(Error),
    );
  });
});

describe("POST with AUTH_USE_BETTER_AUTH on", () => {
  // Better Auth's path reads the raw body, so these are real Requests.
  function formRequest(
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ) {
    return new Request("https://auth.test.invalid/api/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    }) as unknown as NextRequest;
  }

  beforeEach(() => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(forwardToBetterAuth).mockResolvedValue(
      Response.json(
        { access_token: "ba-at" },
        { headers: { "cache-control": "no-store" } },
      ),
    );
  });

  it("forwards the body unchanged, without cookies, and adds the client's CORS headers", async () => {
    const fields = {
      grant_type: "authorization_code",
      client_id: "some-client",
      client_secret: "some-secret",
      code: "abc",
    };
    const req = formRequest(fields, { cookie: "better-auth.session_token=s" });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "ba-at" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com",
    );
    expect(forwardToBetterAuth).toHaveBeenCalledWith(req, "token", {
      body: new URLSearchParams(fields).toString(),
      dropCookies: true,
    });
    expect(getCorsHeaders).toHaveBeenCalledWith(req, "some-client");
    expect(rateLimit).toHaveBeenCalledWith("token:some-client", 60, 60000);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rate limits by the client_id in a Basic auth header", async () => {
    const basic = Buffer.from("basic-client:basic-secret").toString("base64");
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0 });

    const res = await POST(
      formRequest(
        { grant_type: "refresh_token", refresh_token: "rt" },
        { authorization: `Basic ${basic}` },
      ),
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limit_exceeded" });
    expect(rateLimit).toHaveBeenCalledWith("token:basic-client", 60, 60000);
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });

  it("leaves a request with no client_id to Better Auth, with no CORS headers", async () => {
    const res = await POST(formRequest({ grant_type: "authorization_code" }));

    expect(res.status).toBe(200);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(getCorsHeaders).not.toHaveBeenCalled();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns a 500 server_error with CORS headers and logs when Better Auth throws", async () => {
    vi.mocked(forwardToBetterAuth).mockRejectedValue(new Error("db down"));

    const res = await POST(
      formRequest({ grant_type: "refresh_token", client_id: "some-client" }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com",
    );
    expect(logError).toHaveBeenCalledWith(
      "auth.oauth.token_endpoint_error",
      { grantType: "refresh_token", clientId: "some-client" },
      expect.any(Error),
    );
  });
});
