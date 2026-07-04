import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@acme/sso", () => ({
  parseOAuthState: vi.fn(),
  isOAuthStateExpired: vi.fn(),
}));

vi.mock("@/lib/auth/oauth", () => ({
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
}));

vi.mock("@/lib/auth/validation", () => ({
  safeReturnTo: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { isOAuthStateExpired, parseOAuthState } from "@acme/sso";
import { exchangeCodeForToken, getUserInfo } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";
import { logError, logInfo, logWarn } from "@/lib/logging";

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

describe("Auth /callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://me.f3nation.test";
    vi.mocked(parseOAuthState).mockReturnValue({
      csrfToken: "csrf-token",
      returnTo: "/profile",
      timestamp: Date.now(),
    });
    vi.mocked(isOAuthStateExpired).mockReturnValue(false);
    vi.mocked(safeReturnTo).mockReturnValue("/profile");
    vi.mocked(exchangeCodeForToken).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    vi.mocked(getUserInfo).mockResolvedValue({
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

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=access_denied",
    );
    expect(parseOAuthState).not.toHaveBeenCalled();
  });

  it("handles missing params and invalid state", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");

    const missing = await GET(
      makeRequest("https://me.f3nation.test/api/auth/callback?code=abc"),
    );
    expect(missing.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=missing_params",
    );

    vi.mocked(parseOAuthState).mockReturnValueOnce(null);
    const invalidState = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=bad-state",
      ),
    );
    expect(invalidState.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=invalid_state",
    );
  });

  it("rejects expired state and csrf mismatch", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");

    vi.mocked(isOAuthStateExpired).mockReturnValueOnce(true);
    const expired = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
      ),
    );
    expect(expired.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=expired_state",
    );

    const csrfMismatch = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
      ),
    );
    expect(csrfMismatch.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=csrf_mismatch",
    );
  });

  it("handles missing code verifier and exchange/userinfo failures", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");

    const missingVerifier = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
        { oauth_csrf: "csrf-token" },
      ),
    );
    expect(missingVerifier.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=missing_code_verifier&redirect=%2Fprofile",
    );

    vi.mocked(exchangeCodeForToken).mockRejectedValueOnce(new Error("boom"));
    const exchangeFailure = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
        { oauth_csrf: "csrf-token", oauth_code_verifier: "code-verifier" },
      ),
    );
    expect(exchangeFailure.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=token_exchange_failed&redirect=%2Fprofile",
    );
    expect(logError).toHaveBeenCalledWith(
      "me.auth.callback.token_exchange_failed",
      { returnTo: "/profile" },
      expect.any(Error),
    );

    vi.mocked(exchangeCodeForToken).mockResolvedValueOnce({ accessToken: "a" });
    vi.mocked(getUserInfo).mockRejectedValueOnce(new Error("userinfo failed"));
    const userInfoFailure = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
        { oauth_csrf: "csrf-token", oauth_code_verifier: "code-verifier" },
      ),
    );
    expect(userInfoFailure.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=userinfo_failed&redirect=%2Fprofile",
    );
  });

  it("rejects user without email", async () => {
    vi.mocked(getUserInfo).mockResolvedValueOnce({ sub: 42 });

    const { GET } = await import("@/app/api/auth/callback/route");
    const response = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
        { oauth_csrf: "csrf-token", oauth_code_verifier: "code-verifier" },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://me.f3nation.test/?error=user_not_found&redirect=%2Fprofile",
    );
    expect(logWarn).toHaveBeenCalledWith(
      "me.auth.callback.user_missing_email",
      {
        userSub: 42,
        returnTo: "/profile",
      },
    );
  });

  it("sets auth cookies and clears oauth flow cookies on success", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");
    const response = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/callback?code=abc&state=ok-state",
        { oauth_csrf: "csrf-token", oauth_code_verifier: "code-verifier" },
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://me.f3nation.test/profile",
    );

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("access_token=access-token");
    expect(setCookieHeader).toContain("refresh_token=refresh-token");
    expect(setCookieHeader).toContain("oauth_csrf=");
    expect(setCookieHeader).toContain("oauth_code_verifier=");
    expect(logInfo).toHaveBeenCalledWith(
      "me.auth.callback.success",
      expect.objectContaining({ userSub: 42, returnTo: "/profile" }),
    );
  });
});
