import { beforeEach, describe, expect, it, vi } from "vitest";

const getOAuthConfigMock = vi.fn();
const getAuthorizationUrlMock = vi.fn();
const exchangeCodeForTokenMock = vi.fn();
const getUserInfoMock = vi.fn();
const refreshTokenMock = vi.fn();
const revokeTokenMock = vi.fn();

const AuthClientMock = vi.fn(
  class AuthClientMock {
    getOAuthConfig = getOAuthConfigMock;
    getAuthorizationUrl = getAuthorizationUrlMock;
    exchangeCodeForToken = exchangeCodeForTokenMock;
    getUserInfo = getUserInfoMock;
    refreshToken = refreshTokenMock;
    revokeToken = revokeTokenMock;
  },
);

async function loadModuleWithEnv(envOverrides: {
  NODE_ENV: string;
  AUTH_PROVIDER_URL: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_REDIRECT_URI?: string;
}) {
  vi.resetModules();

  vi.doMock("@f3nation/sso", () => ({
    AuthClient: AuthClientMock,
  }));

  vi.doMock("@/env", () => ({
    env: {
      NODE_ENV: envOverrides.NODE_ENV,
      AUTH_PROVIDER_URL: envOverrides.AUTH_PROVIDER_URL,
      OAUTH_CLIENT_ID: envOverrides.OAUTH_CLIENT_ID ?? "client-id",
      OAUTH_CLIENT_SECRET: envOverrides.OAUTH_CLIENT_SECRET ?? "client-secret",
      OAUTH_REDIRECT_URI:
        envOverrides.OAUTH_REDIRECT_URI ??
        "https://me.f3nation.test/api/auth/callback",
    },
  }));

  return import("@/lib/auth/oauth");
}

describe("lib/auth/oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      redirectUri: "https://me.f3nation.test/api/auth/callback",
      authServerUrl: "http://auth.local",
    });
    getAuthorizationUrlMock.mockReturnValue("https://auth.local/authorize");
    exchangeCodeForTokenMock.mockResolvedValue({ accessToken: "access" });
    getUserInfoMock.mockResolvedValue({ sub: 42, email: "me@f3nation.test" });
    refreshTokenMock.mockResolvedValue({ accessToken: "new-access" });
    revokeTokenMock.mockResolvedValue(undefined);
  });

  it("builds auth client once and delegates all helper calls", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "test",
      AUTH_PROVIDER_URL: "http://auth.local",
    });

    const oauthConfig = oauth.sso.getOAuthConfig();
    const authUrl = oauth.sso.getAuthorizationUrl({
      state: "state-1",
      codeChallenge: "challenge-1",
      codeChallengeMethod: "S256",
    });
    const tokens = await oauth.sso.exchangeCodeForToken({
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    const userInfo = await oauth.sso.getUserInfo("access-1");
    const refreshed = await oauth.sso.refreshToken({
      refreshToken: "refresh-1",
    });
    await oauth.sso.revokeToken("refresh-1");

    expect(oauthConfig).toEqual({
      clientId: "client-id",
      redirectUri: "https://me.f3nation.test/api/auth/callback",
      authServerUrl: "http://auth.local",
    });
    expect(authUrl).toBe("https://auth.local/authorize");
    expect(tokens).toEqual({ accessToken: "access" });
    expect(userInfo).toEqual({ sub: 42, email: "me@f3nation.test" });
    expect(refreshed).toEqual({ accessToken: "new-access" });

    expect(AuthClientMock).toHaveBeenCalledTimes(1);
    expect(AuthClientMock).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://me.f3nation.test/api/auth/callback",
      authServerUrl: "http://auth.local",
    });

    expect(getAuthorizationUrlMock).toHaveBeenCalledWith({
      state: "state-1",
      codeChallenge: "challenge-1",
      codeChallengeMethod: "S256",
    });
    expect(exchangeCodeForTokenMock).toHaveBeenCalledWith({
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(getUserInfoMock).toHaveBeenCalledWith("access-1");
    expect(refreshTokenMock).toHaveBeenCalledWith({
      refreshToken: "refresh-1",
    });
    expect(revokeTokenMock).toHaveBeenCalledWith("refresh-1");
  });

  it("throws in production when AUTH_PROVIDER_URL is not https", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "production",
      AUTH_PROVIDER_URL: "http://auth.insecure.test",
    });

    expect(() => oauth.sso.getOAuthConfig()).toThrow(
      "AUTH_PROVIDER_URL must use HTTPS in production",
    );
    expect(AuthClientMock).not.toHaveBeenCalled();
  });

  it("allows https AUTH_PROVIDER_URL in production", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "production",
      AUTH_PROVIDER_URL: "https://auth.f3nation.test",
    });

    oauth.sso.getOAuthConfig();

    expect(AuthClientMock).toHaveBeenCalledTimes(1);
    expect(AuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ authServerUrl: "https://auth.f3nation.test" }),
    );
  });
});
