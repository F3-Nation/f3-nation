import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isJwtExpired,
  parseJwtPayload,
  verifyAccessToken as verifyAccessTokenWithResult,
  verifyJwtWithJwks,
} from "@acme/sso";
import {
  isAccessTokenExpired,
  parseAccessTokenPayload,
  verifyAccessToken,
  verifyAccessTokenPayload,
} from "@/lib/auth/tokens";
import { logError, logWarn } from "@/lib/logging";

// tokens.ts reads credentials from the validated `@/env` module, which
// @t3-oss/env-nextjs evaluates from process.env once at import time. Mock it so
// the values are deterministic (and to bypass import-time env validation).
vi.mock("@/env", () => ({
  env: {
    AUTH_PROVIDER_URL: "https://auth.test.com",
    OAUTH_CLIENT_ID: "test-client-id",
  },
}));

vi.mock("@acme/sso", async () => {
  const actual = await vi.importActual("@acme/sso");

  return {
    ...actual,
    isJwtExpired: vi.fn(),
    parseJwtPayload: vi.fn(),
    verifyAccessToken: vi.fn(),
    verifyJwtWithJwks: vi.fn(),
  };
});

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

function createToken(payload: Record<string, unknown>) {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return `${encodedHeader}.${encodedPayload}.signature`;
}

function createValidToken(extra: Record<string, unknown> = {}) {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  return createToken({
    sub: "42",
    email: "test@f3.com",
    exp: futureExp,
    ...extra,
  });
}

describe("auth tokens", () => {
  it("parses JWT payloads", () => {
    const token = createToken({ sub: "42", email: "test@f3.com", exp: 9999 });
    vi.mocked(parseJwtPayload).mockReturnValueOnce({
      sub: "42",
      email: "test@f3.com",
      exp: 9999,
    });

    expect(parseAccessTokenPayload(token)).toEqual(
      expect.objectContaining({
        sub: "42",
        email: "test@f3.com",
        exp: 9999,
      }),
    );
  });

  it("returns null for invalid JWT format", () => {
    vi.mocked(parseJwtPayload).mockReturnValueOnce(null);
    expect(parseAccessTokenPayload("not-a-jwt")).toBeNull();
  });

  it("treats malformed payloads as expired", () => {
    vi.mocked(isJwtExpired).mockReturnValueOnce(true);
    expect(isAccessTokenExpired("not-a-jwt")).toBe(true);
  });

  it("treats tokens without exp as expired", () => {
    vi.mocked(isJwtExpired).mockReturnValueOnce(true);
    const token = createToken({ sub: "42", email: "test@f3.com" });
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("treats tokens with non-numeric exp as expired", () => {
    vi.mocked(isJwtExpired).mockReturnValueOnce(true);
    const token = createToken({ sub: "42", exp: "not-a-number" });
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("accepts tokens whose exp is comfortably in the future", () => {
    vi.mocked(isJwtExpired).mockReturnValueOnce(false);
    const token = createToken({
      sub: "42",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(isAccessTokenExpired(token)).toBe(false);
  });

  it("treats nearly-expired tokens as expired when within skew", () => {
    vi.mocked(isJwtExpired).mockReturnValueOnce(true);
    const token = createToken({
      sub: "42",
      exp: Math.floor(Date.now() / 1000) + 30,
    });
    expect(isAccessTokenExpired(token)).toBe(true);
  });
});

describe("verifyAccessTokenPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when verifier returns failure result", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: false,
      code: "expired",
      message: "Token expired",
    });
    const result = await verifyAccessTokenPayload(expiredToken);
    expect(result).toBeNull();
    expect(verifyJwtWithJwks).toHaveBeenCalledTimes(1);
  });

  it("returns payload when shared verifier succeeds", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: true,
      payload: {
        sub: "42",
        email: "test@f3.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42", email: "test@f3.com" });
    expect(verifyJwtWithJwks).toHaveBeenCalledTimes(1);
  });

  it("returns null when strict verify succeeds but sub is not a string", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: true,
      payload: {
        sub: 42 as never,
        email: "test@f3.com",
      },
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns payload when shared verifier returns client_id payload", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: true,
      payload: {
        sub: "42",
        email: "test@f3.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
        client_id: "test-client-id",
      },
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42" });
  });

  it("returns null when shared verifier returns a payload without sub", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: true,
      payload: {
        email: "test@f3.com",
      },
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns null when shared verifier returns null", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: false,
      code: "invalid_token",
      message: "Token verification failed",
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("logs non-expired verifier failures", async () => {
    vi.mocked(verifyJwtWithJwks).mockResolvedValueOnce({
      ok: false,
      code: "invalid_signature",
      message: "Token signature verification failed",
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
    expect(logWarn).toHaveBeenCalledWith(
      "me.auth.access_token_payload_verify_failed",
      { code: "invalid_signature" },
    );
  });

  it("logs thrown verifier errors as misconfiguration", async () => {
    vi.mocked(verifyJwtWithJwks).mockRejectedValueOnce(
      new Error("authServerUrl must use https:// outside localhost"),
    );

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      "me.auth.access_token_payload_verify_misconfigured",
      {},
      expect.any(Error),
    );
  });
});

describe("verifyAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when verifier returns false-like result", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    vi.mocked(verifyAccessTokenWithResult).mockResolvedValueOnce({
      ok: false,
      code: "expired",
      error: "Token expired",
    });

    const result = await verifyAccessToken(expiredToken);

    expect(result).toBe(false);
    expect(verifyAccessTokenWithResult).toHaveBeenCalledTimes(1);
  });

  it("returns true when shared verifier succeeds", async () => {
    vi.mocked(verifyAccessTokenWithResult).mockResolvedValueOnce({ ok: true });

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(true);
    expect(verifyAccessTokenWithResult).toHaveBeenCalledTimes(1);
  });

  it("returns false when shared verifier reports failure", async () => {
    vi.mocked(verifyAccessTokenWithResult).mockResolvedValueOnce({
      ok: false,
      code: "invalid_token",
      error: "Token verification failed",
    });

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(false);
  });

  it("passes auth server settings to the shared verifier", async () => {
    vi.mocked(verifyAccessTokenWithResult).mockResolvedValueOnce({ ok: true });

    await verifyAccessToken(createValidToken());

    expect(verifyAccessTokenWithResult).toHaveBeenCalledWith(
      expect.any(String),
      "https://auth.test.com",
      "test-client-id",
      true,
    );
  });

  it("logs helper failures without verification code as misconfiguration", async () => {
    vi.mocked(verifyAccessTokenWithResult).mockResolvedValueOnce({
      ok: false,
      error: "authServerUrl must use https:// outside localhost",
    });

    const result = await verifyAccessToken(createValidToken());
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "me.auth.access_token_verify_misconfigured",
      {
        message: "authServerUrl must use https:// outside localhost",
      },
    );
  });
});
