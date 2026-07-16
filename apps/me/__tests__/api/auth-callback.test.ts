import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createOAuthLoginFlowArtifacts } from "@f3nation/sso";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ssoMock = vi.hoisted(() => ({
  getOAuthConfig: vi.fn(() => ({
    clientId: "test-client",
    redirectUri: "https://me.f3nation.test/api/auth/callback",
    authServerUrl: "https://auth.f3nation.test",
  })),
  getAuthorizationUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  refreshToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("@/lib/auth/oauth", () => ({
  sso: ssoMock,
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { logError, logInfo, logWarn } from "@/lib/logging";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, cookieValues: Record<string, string> = {}) {
  return {
    nextUrl: new URL(url),
    cookies: {
      get: (name: string) => {
        const value = cookieValues[name];
        return value ? { value } : undefined;
      },
    },
  } as unknown as NextRequest;
}

/** Build a request with a cryptographically valid CSRF token + state. */
async function makeValidRequest(returnTo = "/profile") {
  const artifacts = await createOAuthLoginFlowArtifacts({ returnTo });
  const url = `https://me.f3nation.test/api/auth/callback?code=auth_code&state=${artifacts.state}`;
  return {
    request: makeRequest(url, {
      oauth_csrf: artifacts.csrfToken,
      oauth_code_verifier: artifacts.codeVerifier,
    }),
    ...artifacts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth /callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = "https://me.f3nation.test";
    ssoMock.exchangeCodeForToken.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    ssoMock.getUserInfo.mockResolvedValue({
      sub: 42,
      email: "me@f3nation.test",
      name: "Pax",
    });
  });

  it("redirects auth server errors immediately", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");
    const response = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?error=access_denied",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=access_denied");
  });

  it("handles missing params and invalid state", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");

    const missing = await GET(
      makeRequest("https://me.f3nation.test/api/auth/callback?code=abc"),
    );
    expect(missing.headers.get("location")).toContain("error=missing_params");

    const invalidState = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=not-base64!",
      ),
    );
    expect(invalidState.headers.get("location")).toContain(
      "error=invalid_state",
    );
  });

  it("rejects CSRF mismatch", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");
    const { state } = await makeValidRequest();

    const response = await GET(
      makeRequest(
        `https://me.f3nation.test/api/auth/callback?code=abc&state=${state}`,
        { oauth_csrf: "wrong-token" },
      ),
    );
    expect(response.headers.get("location")).toContain("error=csrf_mismatch");
  });

  it("rejects missing code verifier", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");
    const { state, csrfToken } = await makeValidRequest();

    const response = await GET(
      makeRequest(
        `https://me.f3nation.test/api/auth/callback?code=abc&state=${state}`,
        { oauth_csrf: csrfToken },
        // no oauth_code_verifier cookie
      ),
    );
    expect(response.headers.get("location")).toContain(
      "error=missing_code_verifier",
    );
  });

  it("handles token exchange failure", async () => {
    ssoMock.exchangeCodeForToken.mockRejectedValueOnce(new Error("boom"));

    const { GET } = await import("@/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain(
      "error=token_exchange_failed",
    );
    expect(logError).toHaveBeenCalledWith(
      "me.auth.callback.token_exchange_failed",
      {},
      expect.any(Error),
    );
  });

  it("handles userinfo failure", async () => {
    ssoMock.getUserInfo.mockRejectedValueOnce(new Error("userinfo failed"));

    const { GET } = await import("@/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("error=userinfo_failed");
  });

  it("rejects user without email", async () => {
    ssoMock.getUserInfo.mockResolvedValueOnce({ sub: 42 });

    const { GET } = await import("@/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("error=user_not_found");
    expect(logWarn).toHaveBeenCalledWith(
      "me.auth.callback.user_missing_email",
      expect.objectContaining({ userSub: 42 }),
    );
  });

  it("sets auth cookies and clears oauth flow cookies on success", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");
    const { request } = await makeValidRequest("/profile");
    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/profile");

    const setCookies = response.headers.getSetCookie();
    const names = setCookies.map((c) => c.split("=")[0]);
    expect(names).toContain("access_token");
    expect(names).toContain("refresh_token");
    expect(
      setCookies.some(
        (c) => c.startsWith("oauth_csrf=") && c.includes("Max-Age=0"),
      ),
    ).toBe(true);
    expect(logInfo).toHaveBeenCalledWith(
      "me.auth.callback.success",
      expect.objectContaining({ userSub: 42 }),
    );
  });

  it("redirects when token exchange returns without accessToken", async () => {
    ssoMock.exchangeCodeForToken.mockResolvedValueOnce({ accessToken: "" });

    const { GET } = await import("@/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("token_exchange_failed");
  });

  it("throws when NEXT_PUBLIC_SITE_URL is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const { GET } = await import("@/app/api/auth/callback/route");
    await expect(
      GET(makeRequest("http://localhost/api/auth/callback?error=test")),
    ).rejects.toThrow("NEXT_PUBLIC_SITE_URL is not configured");
  });
});
