import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));

const legacyKey = {
  kty: "RSA",
  kid: "f3-auth-1",
  alg: "RS256",
  n: "n",
  e: "AQAB",
};
vi.mock("~/lib/jwt", () => ({
  getJWKS: vi.fn(async () => ({ keys: [legacyKey] })),
}));

const getJwksMock = vi.fn();
const getAuthMock = vi.fn(async () => ({ api: { getJwks: getJwksMock } }));
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));

const logErrorMock = vi.fn();
vi.mock("~/lib/logging", () => ({ logError: logErrorMock }));

const { getJWKS } = await import("~/lib/jwt");
const { GET } = await import("../../../src/app/.well-known/jwks.json/route");

const betterAuthKey = {
  kty: "RSA",
  kid: "ba-generated-id",
  alg: "RS256",
  n: "m",
  e: "AQAB",
};

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
  getJwksMock.mockResolvedValue({ keys: [betterAuthKey] });
});

describe("/.well-known/jwks.json", () => {
  it("serves only the hand-rolled key, without touching Better Auth, when the flag is off", async () => {
    const res = await GET();

    expect(await res.json()).toEqual({ keys: [legacyKey] });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it("adds Better Auth's keys next to the hand-rolled key when the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;

    const res = await GET();

    expect(await res.json()).toEqual({ keys: [legacyKey, betterAuthKey] });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("answers 503, uncached and logged, when Better Auth's keys can't be read", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const err = new Error("connection refused");
    getJwksMock.mockRejectedValue(err);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "jwks_unavailable" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.jwks.better_auth_keys_failed",
      {},
      err,
    );
  });

  it("answers 503 the same way, under its own event, when the Better Auth instance can't be built", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const err = new Error("BETTER_AUTH_SECRET is not configured");
    getAuthMock.mockRejectedValueOnce(err);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "jwks_unavailable" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getJwksMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.jwks.better_auth_instance_failed",
      {},
      err,
    );
  });

  it("answers 503, uncached and logged, when the hand-rolled key can't be read", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const err = new Error("AUTH_JWT_PRIVATE_KEY is not a valid key");
    vi.mocked(getJWKS).mockRejectedValueOnce(err);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getAuthMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(
      "auth.jwks.legacy_key_failed",
      {},
      err,
    );
  });
});
