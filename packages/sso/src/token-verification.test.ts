import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isJwtExpired,
  parseJwtPayload,
  verifyJwtWithJwks,
} from "./token-verification";

const { createRemoteJWKSetMock, jwtVerifyMock } = vi.hoisted(() => ({
  createRemoteJWKSetMock: vi.fn(() => ({}) as never),
  jwtVerifyMock: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: createRemoteJWKSetMock,
  jwtVerify: jwtVerifyMock,
}));

function makeToken(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig",
  ].join(".");
}

describe("token verification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    createRemoteJWKSetMock.mockClear();
    jwtVerifyMock.mockReset();
  });

  it("returns payload for valid token", async () => {
    const token = makeToken({
      sub: "123",
      email: "test@example.com",
      exp: 1_900_000_000,
    });

    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "123", email: "test@example.com" },
    });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
    });

    expect(result).toEqual({
      ok: true,
      payload: { sub: "123", email: "test@example.com" },
    });
  });

  it("returns expired for token with past exp claim", async () => {
    const token = makeToken({ sub: "123", exp: 1_600_000_000 });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
    });

    expect(result).toEqual({
      ok: false,
      code: "expired",
      message: "Token expired",
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("returns invalid_signature for bad signature", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const signatureError = new Error("signature failed");
    signatureError.name = "JWSSignatureVerificationFailed";

    jwtVerifyMock.mockRejectedValue(signatureError);

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
      allowClientIdClaimFallback: false,
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_signature",
      message: "Token signature verification failed",
    });
  });

  it("returns issuer_mismatch when issuer claim check fails", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const claimError = new Error("claim failed") as Error & { claim?: string };
    claimError.name = "JWTClaimValidationFailed";
    claimError.claim = "iss";

    jwtVerifyMock.mockRejectedValue(claimError);

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
      allowClientIdClaimFallback: false,
    });

    expect(result).toEqual({
      ok: false,
      code: "issuer_mismatch",
      message: "Token issuer mismatch",
    });
  });

  it("returns audience_mismatch when audience claim check fails", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const claimError = new Error("claim failed") as Error & { claim?: string };
    claimError.name = "JWTClaimValidationFailed";
    claimError.claim = "aud";

    jwtVerifyMock.mockRejectedValue(claimError);

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
      allowClientIdClaimFallback: false,
    });

    expect(result).toEqual({
      ok: false,
      code: "audience_mismatch",
      message: "Token audience mismatch",
    });
  });

  it("falls back to client_id check when aud claim is absent", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const audError = new Error("audience mismatch") as Error & {
      claim?: string;
    };
    audError.name = "JWTClaimValidationFailed";
    audError.claim = "aud";

    jwtVerifyMock
      .mockRejectedValueOnce(audError)
      .mockResolvedValueOnce({ payload: { sub: "123", client_id: "web" } });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web",
    });

    expect(result).toEqual({
      ok: true,
      payload: { sub: "123", client_id: "web" },
    });
  });
});

describe("token parsing helpers", () => {
  it("parses JWT payload", () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    expect(parseJwtPayload(token)).toEqual({ sub: "123", exp: 1_900_000_000 });
  });

  it("marks token expired when exp is missing", () => {
    const token = makeToken({ sub: "123" });
    expect(isJwtExpired(token)).toBe(true);
  });
});
