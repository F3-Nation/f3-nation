import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const ssoMock = vi.hoisted(() => ({
  getAuthorizationUrl: vi.fn(),
}));
const createOAuthLoginFlowArtifacts = vi.hoisted(() => vi.fn());

vi.mock("@f3nation/sso", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createOAuthLoginFlowArtifacts,
}));

vi.mock("~/lib/auth/oauth", () => ({
  sso: ssoMock,
}));

function makeRequest(url: string) {
  return {
    nextUrl: new URL(url),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("Auth /login route (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOAuthLoginFlowArtifacts).mockResolvedValue({
      csrfToken: "csrf-token",
      codeVerifier: "code-verifier",
      codeChallenge: "code-challenge",
      state: "oauth-state",
    });
    ssoMock.getAuthorizationUrl.mockReturnValue(
      "https://auth.f3nation.test/api/oauth/authorize?state=oauth-state",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to the auth server and sets short-lived oauth cookies", async () => {
    const { GET } = await import("~/app/api/auth/login/route");
    const response = await GET(
      makeRequest(
        "https://admin.f3nation.test/api/auth/login?returnTo=/workouts",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("oauth-state");
    expect(createOAuthLoginFlowArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/workouts" }),
    );
    expect(ssoMock.getAuthorizationUrl).toHaveBeenCalledWith({
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

  it("falls back to '/' when no returnTo is supplied", async () => {
    const { GET } = await import("~/app/api/auth/login/route");
    await GET(makeRequest("https://admin.f3nation.test/api/auth/login"));

    expect(createOAuthLoginFlowArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/" }),
    );
  });

  it("sanitizes unsafe returnTo to the default '/'", async () => {
    const { GET } = await import("~/app/api/auth/login/route");
    await GET(
      makeRequest(
        "https://admin.f3nation.test/api/auth/login?returnTo=https://evil.test",
      ),
    );

    expect(createOAuthLoginFlowArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/" }),
    );
  });

  it("marks cookies Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { GET } = await import("~/app/api/auth/login/route");
    const response = await GET(
      makeRequest("https://admin.f3nation.test/api/auth/login"),
    );

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("Secure");
  });
});
