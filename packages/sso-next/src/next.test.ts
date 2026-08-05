import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import {
  buildSsoCookieOptions,
  createSsoAdapter,
  handleCallbackRoute,
  handleLoginRoute,
  handleLogoutRoute,
} from "./next";
import type { SsoAdapter } from "./next";
import { createOAuthLoginFlowArtifacts, parseOAuthState } from "@f3nation/sso";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  url: string,
  cookieValues: Record<string, string> = {},
): NextRequest {
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

function makeMockAdapter(overrides: Partial<SsoAdapter> = {}): SsoAdapter {
  return {
    getOAuthConfig: () => ({
      clientId: "test-client",
      redirectUri: "https://app.test/api/auth/callback",
      authServerUrl: "https://auth.test",
    }),
    getAuthorizationUrl: ({ state, codeChallenge, codeChallengeMethod }) =>
      `https://auth.test/authorize?state=${state ?? ""}&code_challenge=${codeChallenge ?? ""}&code_challenge_method=${codeChallengeMethod ?? ""}`,
    exchangeCodeForToken: vi.fn().mockResolvedValue({
      accessToken: "at_test",
      refreshToken: "rt_test",
      expiresIn: 3600,
    }),
    getUserInfo: vi.fn().mockResolvedValue({
      sub: 42,
      email: "user@test.com",
      name: "Test User",
    }),
    refreshToken: vi.fn(),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const TEST_COOKIE_NAMES = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  oauthCsrf: "oauth_csrf",
  oauthCodeVerifier: "oauth_code_verifier",
};

// ---------------------------------------------------------------------------
// buildSsoCookieOptions
// ---------------------------------------------------------------------------

describe("buildSsoCookieOptions", () => {
  it("returns httpOnly lax options with given maxAge", () => {
    const opts = buildSsoCookieOptions(3600);
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
  });

  it("returns maxAge 0 for a clear-cookie instruction", () => {
    expect(buildSsoCookieOptions(0).maxAge).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createSsoAdapter
// ---------------------------------------------------------------------------

describe("createSsoAdapter", () => {
  it("builds the AuthClient lazily (factory not called until first use)", () => {
    const factory = vi.fn().mockReturnValue({
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "https://app.test/cb",
      authServerUrl: "https://auth.test",
    });

    const adapter = createSsoAdapter(factory);
    expect(factory).not.toHaveBeenCalled();

    adapter.getOAuthConfig();
    expect(factory).toHaveBeenCalledOnce();

    adapter.getOAuthConfig();
    expect(factory).toHaveBeenCalledOnce(); // still only once (cached)
  });

  it("exposes all required methods", () => {
    const adapter = createSsoAdapter(() => ({
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "https://app.test/cb",
      authServerUrl: "https://auth.test",
    }));

    for (const method of [
      "getOAuthConfig",
      "getAuthorizationUrl",
      "exchangeCodeForToken",
      "getUserInfo",
      "refreshToken",
      "revokeToken",
    ]) {
      expect(
        typeof (adapter as unknown as Record<string, unknown>)[method],
      ).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// handleLoginRoute
// ---------------------------------------------------------------------------

describe("handleLoginRoute", () => {
  it("redirects to the auth server authorisation URL", async () => {
    const adapter = makeMockAdapter();
    const request = makeRequest("https://app.test/api/auth/login");

    const response = await handleLoginRoute(request, {
      adapter,
      cookieNames: {
        oauthCsrf: TEST_COOKIE_NAMES.oauthCsrf,
        oauthCodeVerifier: TEST_COOKIE_NAMES.oauthCodeVerifier,
      },
      flowCookieMaxAge: 600,
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("https://auth.test/authorize");
    expect(location).toContain("code_challenge_method=S256");
  });

  it("sets CSRF and code-verifier cookies", async () => {
    const adapter = makeMockAdapter();
    const request = makeRequest("https://app.test/api/auth/login");

    const response = await handleLoginRoute(request, {
      adapter,
      cookieNames: {
        oauthCsrf: TEST_COOKIE_NAMES.oauthCsrf,
        oauthCodeVerifier: TEST_COOKIE_NAMES.oauthCodeVerifier,
      },
      flowCookieMaxAge: 600,
    });

    const setCookie = response.headers.getSetCookie();
    const names = setCookie.map((c) => c.split("=")[0]);
    expect(names).toContain(TEST_COOKIE_NAMES.oauthCsrf);
    expect(names).toContain(TEST_COOKIE_NAMES.oauthCodeVerifier);
  });

  it("uses defaultReturnTo when returnTo is absent", async () => {
    const adapter = makeMockAdapter();
    const capturedStates: string[] = [];
    adapter.getAuthorizationUrl = (p) => {
      capturedStates.push(p.state ?? "");
      return `https://auth.test/authorize?state=${p.state ?? ""}`;
    };

    const request = makeRequest("https://app.test/api/auth/login");
    await handleLoginRoute(request, {
      adapter,
      cookieNames: {
        oauthCsrf: TEST_COOKIE_NAMES.oauthCsrf,
        oauthCodeVerifier: TEST_COOKIE_NAMES.oauthCodeVerifier,
      },
      flowCookieMaxAge: 600,
      defaultReturnTo: "/dashboard",
    });

    // Decode and assert the resolved returnTo so a regression in the fallback
    // path would fail this test rather than silently passing.
    expect(capturedStates.length).toBe(1);
    const parsed = parseOAuthState(capturedStates[0] ?? "");
    expect(parsed?.returnTo).toBe("/dashboard");
  });
});

// ---------------------------------------------------------------------------
// handleCallbackRoute
// ---------------------------------------------------------------------------

describe("handleCallbackRoute", () => {
  async function makeValidCallbackRequest(
    overrides: Partial<{
      returnTo: string;
      csrfToken: string;
      codeVerifier: string;
      state: string;
    }> = {},
  ) {
    const { csrfToken, codeVerifier, codeChallenge, state } =
      await createOAuthLoginFlowArtifacts({
        returnTo: overrides.returnTo ?? "/profile",
      });
    void codeChallenge; // used by login route; not needed in callback test

    const stateParam = overrides.state ?? state;
    const url = `https://app.test/api/auth/callback?code=auth_code&state=${stateParam}`;

    return {
      request: makeRequest(url, {
        [TEST_COOKIE_NAMES.oauthCsrf]: overrides.csrfToken ?? csrfToken,
        [TEST_COOKIE_NAMES.oauthCodeVerifier]:
          overrides.codeVerifier ?? codeVerifier,
      }),
      csrfToken,
      codeVerifier,
      state,
    };
  }

  const BASE_CONFIG = {
    cookieNames: TEST_COOKIE_NAMES,
    publicOrigin: "https://app.test",
    errorPath: "/",
    accessTokenMaxAge: 3600,
    refreshTokenMaxAge: 2592000,
  };

  it("uses the configured state lifetime and rejects an expired state", async () => {
    const adapter = makeMockAdapter();
    const { request } = await makeValidCallbackRequest();

    // stateMaxAgeMs: 0 means any state is immediately expired.
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter,
      stateMaxAgeMs: 0,
    });

    expect(response.headers.get("location")).toContain("error=expired_state");
  });

  it("redirects to returnTo on success and sets auth cookies", async () => {
    const adapter = makeMockAdapter();
    const { request } = await makeValidCallbackRequest();

    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/profile");

    const setCookie = response.headers.getSetCookie();
    const names = setCookie.map((c) => c.split("=")[0]);
    expect(names).toContain(TEST_COOKIE_NAMES.accessToken);
    expect(names).toContain(TEST_COOKIE_NAMES.refreshToken);
  });

  it("clears flow cookies on success", async () => {
    const adapter = makeMockAdapter();
    const { request } = await makeValidCallbackRequest();

    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter,
    });

    const setCookie = response.headers.getSetCookie();
    const csrfClearEntry = setCookie.find((c) =>
      c.startsWith(`${TEST_COOKIE_NAMES.oauthCsrf}=`),
    );
    expect(csrfClearEntry).toContain("Max-Age=0");
  });

  it("redirects to errorPath when auth server returns an error param", async () => {
    const request = makeRequest(
      "https://app.test/api/auth/callback?error=access_denied",
    );
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter: makeMockAdapter(),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=access_denied");
  });

  it("redirects to errorPath on CSRF mismatch", async () => {
    const { request } = await makeValidCallbackRequest({ csrfToken: "wrong" });
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter: makeMockAdapter(),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=csrf_mismatch");
  });

  it("redirects to errorPath when token exchange throws", async () => {
    const adapter = makeMockAdapter({
      exchangeCodeForToken: vi.fn().mockRejectedValue(new Error("bad creds")),
    });
    const { request } = await makeValidCallbackRequest();
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter,
    });
    expect(response.headers.get("location")).toContain(
      "error=token_exchange_failed",
    );
  });

  it("redirects to errorPath when validateUser returns false", async () => {
    const { request } = await makeValidCallbackRequest();
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter: makeMockAdapter(),
      validateUser: (_user, _returnTo) => false,
    });
    expect(response.headers.get("location")).toContain("error=user_not_found");
  });

  it("redirects to errorPath when validateUser throws", async () => {
    const { request } = await makeValidCallbackRequest();
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter: makeMockAdapter(),
      validateUser: () => {
        throw new Error("db error");
      },
    });
    expect(response.headers.get("location")).toContain("error=user_not_found");
  });

  it("uses errorReturnToParam in the error redirect query string", async () => {
    // errorReturnToParam only applies once returnTo has been resolved (i.e.
    // after CSRF+state validation passes). Use a failing token exchange so
    // the error redirect fires with the decoded returnTo path.
    const adapter = makeMockAdapter({
      exchangeCodeForToken: vi.fn().mockRejectedValue(new Error("bad creds")),
    });
    const { request } = await makeValidCallbackRequest({
      returnTo: "/profile",
    });
    const response = await handleCallbackRoute(request, {
      ...BASE_CONFIG,
      adapter,
      errorReturnToParam: "callbackUrl",
    });

    const location = response.headers.get("location") ?? "";
    expect(response.status).toBe(302);
    expect(location).toContain("error=token_exchange_failed");
    expect(location).toContain("callbackUrl=");
    expect(location).not.toContain("returnTo=");
  });
});

// ---------------------------------------------------------------------------
// handleLogoutRoute
// ---------------------------------------------------------------------------

describe("handleLogoutRoute", () => {
  it("returns JSON with ok and redirectTo", async () => {
    const adapter = makeMockAdapter();
    const response = await handleLogoutRoute(() => Promise.resolve("rt_old"), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });

    const body = (await response.json()) as { ok: boolean; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toContain("api/oauth/logout");
    expect(body.redirectTo).toContain(
      encodeURIComponent("https://app.test?logged_out=true"),
    );
  });

  it("calls revokeToken with the refresh token", async () => {
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const adapter = makeMockAdapter({ revokeToken });
    await handleLogoutRoute(() => Promise.resolve("my_refresh_token"), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });
    expect(revokeToken).toHaveBeenCalledWith("my_refresh_token");
  });

  it("skips revokeToken when there is no refresh token", async () => {
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const adapter = makeMockAdapter({ revokeToken });
    await handleLogoutRoute(() => Promise.resolve(undefined), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("clears all auth cookies", async () => {
    const adapter = makeMockAdapter();
    const response = await handleLogoutRoute(() => Promise.resolve(undefined), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });
    const setCookie = response.headers.getSetCookie();
    const cleared = setCookie.filter((c) => c.includes("Max-Age=0"));
    expect(cleared.length).toBeGreaterThanOrEqual(4);
  });

  it("continues clearing cookies even if revokeToken throws", async () => {
    const adapter = makeMockAdapter({
      revokeToken: vi.fn().mockRejectedValue(new Error("revoke failed")),
    });
    const response = await handleLogoutRoute(() => Promise.resolve("rt"), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const cleared = response.headers
      .getSetCookie()
      .filter((c) => c.includes("Max-Age=0"));
    expect(cleared.length).toBeGreaterThanOrEqual(4);
  });

  it("clears cookies and falls back to postLogoutRedirectUri when getOAuthConfig throws", async () => {
    const adapter = makeMockAdapter({
      getOAuthConfig: () => {
        throw new Error("config error");
      },
    });
    const response = await handleLogoutRoute(() => Promise.resolve(undefined), {
      adapter,
      cookieNames: TEST_COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.test?logged_out=true",
    });
    const body = (await response.json()) as { ok: boolean; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toBe("https://app.test?logged_out=true");
    const cleared = response.headers
      .getSetCookie()
      .filter((c) => c.includes("Max-Age=0"));
    expect(cleared.length).toBeGreaterThanOrEqual(4);
  });
});
