import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isJwtExpired,
  parseJwtPayload,
  verifyJwtPayload,
  verifyJwtToken,
} from "@acme/sso";
import {
  isAccessTokenExpired,
  parseAccessTokenPayload,
  verifyAccessToken,
  verifyAccessTokenPayload,
} from "@/lib/auth/tokens";

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
    verifyJwtPayload: vi.fn(),
    verifyJwtToken: vi.fn(),
  };
});

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

  it("returns null when verifyJwtPayload returns null", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce(null);
    const result = await verifyAccessTokenPayload(expiredToken);
    expect(result).toBeNull();
    expect(verifyJwtPayload).toHaveBeenCalledTimes(1);
  });

  it("returns payload when shared verifier succeeds", async () => {
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce({
      sub: "42",
      email: "test@f3.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42", email: "test@f3.com" });
    expect(verifyJwtPayload).toHaveBeenCalledTimes(1);
  });

  it("returns null when strict verify succeeds but sub is not a string", async () => {
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce({
      sub: 42 as never,
      email: "test@f3.com",
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns payload when shared verifier returns client_id payload", async () => {
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce({
      sub: "42",
      email: "test@f3.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: "test-client-id",
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42" });
  });

  it("returns null when shared verifier returns a payload without sub", async () => {
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce({
      email: "test@f3.com",
    });

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns null when shared verifier returns null", async () => {
    vi.mocked(verifyJwtPayload).mockResolvedValueOnce(null);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });
});

describe("verifyAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when verifyJwtToken returns false", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    vi.mocked(verifyJwtToken).mockResolvedValueOnce(false);

    const result = await verifyAccessToken(expiredToken);

    expect(result).toBe(false);
    expect(verifyJwtToken).toHaveBeenCalledTimes(1);
  });

  it("returns true when shared verifier succeeds", async () => {
    vi.mocked(verifyJwtToken).mockResolvedValueOnce(true);

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(true);
    expect(verifyJwtToken).toHaveBeenCalledTimes(1);
  });

  it("returns false when shared verifier reports failure", async () => {
    vi.mocked(verifyJwtToken).mockResolvedValueOnce(false);

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(false);
  });

  it("passes auth server settings to the shared verifier", async () => {
    vi.mocked(verifyJwtToken).mockResolvedValueOnce(true);

    await verifyAccessToken(createValidToken());

    expect(verifyJwtToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        authServerUrl: "https://auth.test.com",
        clientId: "test-client-id",
      }),
    );
  });
});
