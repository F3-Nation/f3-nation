import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isAccessTokenExpired,
  parseAccessTokenPayload,
  verifyAccessTokenPayload,
} from "@/lib/auth/tokens";

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
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      AUTH_PROVIDER_URL: "https://auth.test.com",
      OAUTH_CLIENT_ID: "test-client-id",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null for an expired token without calling jwtVerify", async () => {
    const expiredToken = createToken({ sub: "42", exp: 1 });
    const result = await verifyAccessTokenPayload(expiredToken);
    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("throws when AUTH_PROVIDER_URL is not set", async () => {
    delete process.env.AUTH_PROVIDER_URL;
    await expect(verifyAccessTokenPayload(createValidToken())).rejects.toThrow(
      "AUTH_PROVIDER_URL is required",
    );
  });

  it("throws when OAUTH_CLIENT_ID is not set", async () => {
    delete process.env.OAUTH_CLIENT_ID;
    await expect(verifyAccessTokenPayload(createValidToken())).rejects.toThrow(
      "OAUTH_CLIENT_ID is required",
    );
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
