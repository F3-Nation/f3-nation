import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";

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

    expect(parseAccessTokenPayload(token)).toEqual(
      expect.objectContaining({
        sub: "42",
        email: "test@f3.com",
        exp: 9999,
      }),
    );
  });

  it("returns null for invalid JWT format", () => {
    expect(parseAccessTokenPayload("not-a-jwt")).toBeNull();
  });

  it("treats malformed payloads as expired", () => {
    expect(isAccessTokenExpired("not-a-jwt")).toBe(true);
  });

  it("treats tokens without exp as expired", () => {
    const token = createToken({ sub: "42", email: "test@f3.com" });
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("treats tokens with non-numeric exp as expired", () => {
    const token = createToken({ sub: "42", exp: "not-a-number" });
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("accepts tokens whose exp is comfortably in the future", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createToken({ sub: "42", exp: futureExp });
    expect(isAccessTokenExpired(token)).toBe(false);
  });

  it("treats nearly-expired tokens as expired when within skew", () => {
    const nearExp = Math.floor(Date.now() / 1000) + 30;
    const token = createToken({ sub: "42", exp: nearExp });
    expect(isAccessTokenExpired(token)).toBe(true);
  });
});

describe("verifyAccessTokenPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for an expired token without calling jwtVerify", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    const result = await verifyAccessTokenPayload(expiredToken);
    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("returns payload when strict verify (aud claim) succeeds", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "42", email: "test@f3.com", exp: futureExp },
      protectedHeader: { alg: "RS256" },
    } as never);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42", email: "test@f3.com" });
    expect(jwtVerify).toHaveBeenCalledTimes(1);
  });

  it("returns null when strict verify succeeds but sub is not a string", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: 42, email: "test@f3.com" },
      protectedHeader: { alg: "RS256" },
    } as never);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("falls back to client_id path when strict verify throws, returns payload on match", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("audience mismatch"))
      .mockResolvedValueOnce({
        payload: {
          sub: "42",
          email: "test@f3.com",
          exp: futureExp,
          client_id: "test-client-id",
        },
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toMatchObject({ sub: "42" });
    expect(jwtVerify).toHaveBeenCalledTimes(2);
  });

  it("returns null when fallback verify succeeds but client_id does not match", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("audience mismatch"))
      .mockResolvedValueOnce({
        payload: { sub: "42", client_id: "wrong-client" },
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns null when fallback verify succeeds but sub is not a string", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("audience mismatch"))
      .mockResolvedValueOnce({
        payload: { sub: 99, client_id: "test-client-id" },
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });

  it("returns null when both jwtVerify calls throw", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("sig invalid"))
      .mockRejectedValueOnce(new Error("sig invalid"));

    const result = await verifyAccessTokenPayload(createValidToken());
    expect(result).toBeNull();
  });
});

describe("verifyAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for expired token without calling jwtVerify", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });

    const result = await verifyAccessToken(expiredToken);

    expect(result).toBe(false);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("returns true when strict verify succeeds", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "42", exp: Math.floor(Date.now() / 1000) + 3600 },
      protectedHeader: { alg: "RS256" },
    } as never);

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(true);
    expect(jwtVerify).toHaveBeenCalledTimes(1);
  });

  it("returns true when strict verify fails and fallback client_id matches", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("audience mismatch"))
      .mockResolvedValueOnce({
        payload: {
          sub: "42",
          exp: Math.floor(Date.now() / 1000) + 3600,
          client_id: "test-client-id",
        },
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(true);
    expect(jwtVerify).toHaveBeenCalledTimes(2);
  });

  it("returns false when fallback verify succeeds but client_id mismatches", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("audience mismatch"))
      .mockResolvedValueOnce({
        payload: {
          sub: "42",
          exp: Math.floor(Date.now() / 1000) + 3600,
          client_id: "wrong-client",
        },
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(false);
  });

  it("returns false when both verification attempts throw", async () => {
    vi.mocked(jwtVerify)
      .mockRejectedValueOnce(new Error("sig invalid"))
      .mockRejectedValueOnce(new Error("sig invalid"));

    const result = await verifyAccessToken(createValidToken());

    expect(result).toBe(false);
  });
});
