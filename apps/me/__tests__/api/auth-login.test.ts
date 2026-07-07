import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@acme/sso", () => ({
  createOAuthLoginFlowArtifacts: vi.fn(),
}));

vi.mock("@/lib/auth/oauth", () => ({
  getAuthorizationUrl: vi.fn(),
}));

vi.mock("@/lib/auth/validation", () => ({
  safeReturnTo: vi.fn(),
}));

import { createOAuthLoginFlowArtifacts } from "@acme/sso";
import { getAuthorizationUrl } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";

function makeRequest(url: string) {
  return {
    nextUrl: new URL(url),
    cookies: {
      get: () => undefined,
    },
  } as unknown as NextRequest;
}

describe("Auth /login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeReturnTo).mockReturnValue("/profile");
    vi.mocked(createOAuthLoginFlowArtifacts).mockResolvedValue({
      csrfToken: "csrf-token",
      codeVerifier: "code-verifier",
      codeChallenge: "code-challenge",
      state: "oauth-state",
    });
    vi.mocked(getAuthorizationUrl).mockReturnValue(
      "https://auth.f3nation.test/api/oauth/authorize?state=oauth-state",
    );
  });

  it("redirects to provider and sets short-lived oauth cookies", async () => {
    const { GET } = await import("@/app/api/auth/login/route");
    const response = await GET(
      makeRequest("https://me.f3nation.test/api/auth/login?returnTo=/profile"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("oauth-state");
    expect(safeReturnTo).toHaveBeenCalledWith("/profile");
    expect(createOAuthLoginFlowArtifacts).toHaveBeenCalledWith({
      returnTo: "/profile",
    });
    expect(getAuthorizationUrl).toHaveBeenCalledWith({
      state: "oauth-state",
      codeChallenge: "code-challenge",
      codeChallengeMethod: "S256",
    });

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("oauth_csrf=csrf-token");
    expect(setCookieHeader).toContain("oauth_code_verifier=code-verifier");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=lax");
  });

  it("falls back returnTo through validation and marks cookies secure in prod", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(safeReturnTo).mockReturnValue("/profile");

    const { GET } = await import("@/app/api/auth/login/route");
    const response = await GET(
      makeRequest(
        "https://me.f3nation.test/api/auth/login?returnTo=https://evil.test",
      ),
    );

    expect(safeReturnTo).toHaveBeenCalledWith("https://evil.test");
    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("Secure");

    vi.unstubAllEnvs();
  });
});
