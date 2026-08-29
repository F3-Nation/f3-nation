import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createOAuthLoginFlowArtifacts } from "@f3nation/sso-next";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ssoMock = vi.hoisted(() => ({
  getOAuthConfig: vi.fn(() => ({
    clientId: "test-client",
    redirectUri: "https://admin.f3nation.test/api/auth/callback",
    authServerUrl: "https://auth.f3nation.test",
  })),
  getAuthorizationUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  refreshToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("~/lib/auth/oauth", () => ({
  sso: ssoMock,
}));

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
async function makeValidRequest(returnTo = "/workouts") {
  const artifacts = await createOAuthLoginFlowArtifacts({ returnTo });
  const url = `https://admin.f3nation.test/api/auth/callback?code=auth_code&state=${artifacts.state}`;
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

describe("Auth /callback route (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.F3_ADMIN_BASE_URL = "https://admin.f3nation.test";
    ssoMock.exchangeCodeForToken.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    ssoMock.getUserInfo.mockResolvedValue({
      sub: 42,
      email: "admin@f3nation.test",
      name: "Test Admin",
    });
  });

  it("redirects auth server errors to sign-in page immediately", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");
    const response = await GET(
      makeRequest(
        "https://admin.f3nation.test/api/auth/callback?error=access_denied",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=access_denied");
    expect(response.headers.get("location")).toContain("/auth/sign-in");
  });

  it("redirects when code or state is missing", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");

    const res = await GET(
      makeRequest("https://admin.f3nation.test/api/auth/callback?code=abc"),
    );
    expect(res.headers.get("location")).toContain("error=missing_params");
  });

  it("redirects on invalid state", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");

    const res = await GET(
      makeRequest(
        "https://admin.f3nation.test/api/auth/callback?code=abc&state=not-base64!",
      ),
    );
    expect(res.headers.get("location")).toContain("error=invalid_state");
  });

  it("rejects CSRF mismatch", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");
    const { state } = await makeValidRequest();

    const response = await GET(
      makeRequest(
        `https://admin.f3nation.test/api/auth/callback?code=abc&state=${state}`,
        { oauth_csrf: "wrong-token" },
      ),
    );
    expect(response.headers.get("location")).toContain("error=csrf_mismatch");
  });

  it("rejects missing code verifier", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");
    const { state, csrfToken } = await makeValidRequest();

    const response = await GET(
      makeRequest(
        `https://admin.f3nation.test/api/auth/callback?code=abc&state=${state}`,
        { oauth_csrf: csrfToken },
      ),
    );
    expect(response.headers.get("location")).toContain(
      "error=missing_code_verifier",
    );
  });

  it("redirects on token exchange failure", async () => {
    ssoMock.exchangeCodeForToken.mockRejectedValueOnce(new Error("bad creds"));

    const { GET } = await import("~/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain(
      "error=token_exchange_failed",
    );
  });

  it("redirects on userinfo failure", async () => {
    ssoMock.getUserInfo.mockRejectedValueOnce(new Error("userinfo failed"));

    const { GET } = await import("~/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("error=userinfo_failed");
  });

  it("rejects user without email", async () => {
    ssoMock.getUserInfo.mockResolvedValueOnce({ sub: 42 });

    const { GET } = await import("~/app/api/auth/callback/route");
    const { request } = await makeValidRequest();
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("error=user_not_found");
  });

  it("sets auth cookies and clears oauth flow cookies on success", async () => {
    const { GET } = await import("~/app/api/auth/callback/route");
    const { request } = await makeValidRequest("/workouts");
    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/workouts");

    const setCookies = response.headers.getSetCookie();
    const names = setCookies.map((c) => c.split("=")[0]);
    expect(names).toContain("access_token");
    expect(names).toContain("refresh_token");
    expect(
      setCookies.some(
        (c) => c.startsWith("oauth_csrf=") && c.includes("Max-Age=0"),
      ),
    ).toBe(true);
  });

  it("uses callbackUrl as the error returnTo query param", async () => {
    ssoMock.exchangeCodeForToken.mockRejectedValueOnce(new Error("bad creds"));

    const { GET } = await import("~/app/api/auth/callback/route");
    const { request } = await makeValidRequest("/workouts");
    const response = await GET(request);

    const location = response.headers.get("location") ?? "";
    expect(location).toContain("error=token_exchange_failed");
    expect(location).toContain("callbackUrl=");
    expect(location).not.toContain("returnTo=");
  });

  it("uses F3_ADMIN_BASE_URL for the public origin", async () => {
    process.env.F3_ADMIN_BASE_URL = "https://custom.admin.test";

    const { GET } = await import("~/app/api/auth/callback/route");
    const response = await GET(
      makeRequest(
        "https://admin.f3nation.test/api/auth/callback?error=test_error",
      ),
    );

    expect(response.headers.get("location")).toContain(
      "https://custom.admin.test",
    );
  });
});
