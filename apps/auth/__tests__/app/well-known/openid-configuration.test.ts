import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = {
  NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid",
  AUTH_USE_BETTER_AUTH: false,
};
vi.mock("~/env", () => ({ env: envMock }));
const getAuthMock = vi.fn();
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));

const { GET } =
  await import("../../../src/app/.well-known/openid-configuration/route");

const request = new Request(
  "https://auth.test.invalid/.well-known/openid-configuration",
);

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
});

describe("/.well-known/openid-configuration", () => {
  it("serves the hand-rolled document, without touching Better Auth, when the flag is off", async () => {
    const res = await GET(request);

    expect(await res.json()).toEqual({
      issuer: "https://auth.test.invalid",
      authorization_endpoint: "https://auth.test.invalid/api/oauth/authorize",
      token_endpoint: "https://auth.test.invalid/api/oauth/token",
      userinfo_endpoint: "https://auth.test.invalid/api/oauth/userinfo",
      revocation_endpoint: "https://auth.test.invalid/api/oauth/revoke",
      jwks_uri: "https://auth.test.invalid/.well-known/jwks.json",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
      claims_supported: ["sub", "name", "email", "email_verified", "picture"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it("overrides Better Auth's jwks_uri and end_session_endpoint when the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const getOpenIdConfig = vi.fn().mockResolvedValue({
      issuer: "https://auth.test.invalid",
      authorization_endpoint:
        "https://auth.test.invalid/api/auth2/oauth2/authorize",
      jwks_uri: "https://auth.test.invalid/api/auth2/jwks",
      end_session_endpoint:
        "https://auth.test.invalid/api/auth2/oauth2/end-session",
    });
    getAuthMock.mockResolvedValue({ api: { getOpenIdConfig } });

    const res = await GET(request);

    expect(res.headers.get("cache-control")).toContain("max-age=15");

    expect(await res.json()).toEqual({
      issuer: "https://auth.test.invalid",
      authorization_endpoint:
        "https://auth.test.invalid/api/auth2/oauth2/authorize",
      jwks_uri: "https://auth.test.invalid/.well-known/jwks.json",
      end_session_endpoint: "https://auth.test.invalid/api/oauth/logout",
    });
    expect(getOpenIdConfig).toHaveBeenCalledWith(
      expect.objectContaining({ request }),
    );
  });
});
