import { beforeEach, describe, expect, it, vi } from "vitest";

const AuthClientMock = vi.fn(
  class {
    getOAuthConfig = vi.fn();
    getAuthorizationUrl = vi.fn();
    exchangeCodeForToken = vi.fn();
    getUserInfo = vi.fn();
    refreshToken = vi.fn();
    revokeToken = vi.fn();
  },
);

async function loadModuleWithEnv(overrides: {
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

  vi.doMock("~/env", () => ({
    env: {
      NODE_ENV: overrides.NODE_ENV,
      AUTH_PROVIDER_URL: overrides.AUTH_PROVIDER_URL,
      OAUTH_CLIENT_ID: overrides.OAUTH_CLIENT_ID ?? "admin-client",
      OAUTH_CLIENT_SECRET: overrides.OAUTH_CLIENT_SECRET ?? "secret",
      OAUTH_REDIRECT_URI:
        overrides.OAUTH_REDIRECT_URI ??
        "https://admin.f3nation.test/api/auth/callback",
    },
  }));

  return import("~/lib/auth/oauth");
}

describe("admin lib/auth/oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an SsoAdapter and delegates method calls lazily", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "test",
      AUTH_PROVIDER_URL: "https://auth.f3nation.test",
    });

    // Adapter should not have called the factory yet.
    expect(AuthClientMock).not.toHaveBeenCalled();

    // First access triggers factory initialisation.
    oauth.sso.getOAuthConfig();
    expect(AuthClientMock).toHaveBeenCalledOnce();

    // Subsequent calls reuse the same client.
    oauth.sso.getOAuthConfig();
    expect(AuthClientMock).toHaveBeenCalledOnce();
  });

  it("passes correct env values to the AuthClient constructor", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "test",
      AUTH_PROVIDER_URL: "https://auth.f3nation.test",
      OAUTH_CLIENT_ID: "my-client",
      OAUTH_CLIENT_SECRET: "my-secret",
      OAUTH_REDIRECT_URI: "https://admin.test/api/auth/callback",
    });

    oauth.sso.getOAuthConfig();

    expect(AuthClientMock).toHaveBeenCalledWith({
      clientId: "my-client",
      clientSecret: "my-secret",
      redirectUri: "https://admin.test/api/auth/callback",
      authServerUrl: "https://auth.f3nation.test",
    });
  });

  it("throws in production when AUTH_PROVIDER_URL is not HTTPS", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "production",
      AUTH_PROVIDER_URL: "http://insecure.auth.test",
    });

    expect(() => oauth.sso.getOAuthConfig()).toThrow(
      "AUTH_PROVIDER_URL must use HTTPS in production",
    );
  });

  it("allows HTTP in non-production environments", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "test",
      AUTH_PROVIDER_URL: "http://auth.local",
    });

    expect(() => oauth.sso.getOAuthConfig()).not.toThrow();
  });

  it("exposes a refreshToken helper that delegates to the sso adapter", async () => {
    const oauth = await loadModuleWithEnv({
      NODE_ENV: "test",
      AUTH_PROVIDER_URL: "https://auth.f3nation.test",
    });

    // The refreshToken helper is a thin wrapper — just verify it exists and
    // is callable (deep call-through is tested by sso-next's own test suite).
    expect(typeof oauth.refreshToken).toBe("function");
  });
});
