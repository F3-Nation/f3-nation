import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isJwtExpired,
  parseJwtPayload,
  verifyAccessToken,
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

function makeClaimValidationError(claim: string): Error & {
  code: string;
  claim: string;
} {
  const error = new Error("claim failed") as Error & {
    code: string;
    claim: string;
  };
  error.name = "JWTClaimValidationFailed";
  error.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  error.claim = claim;
  return error;
}

describe("token verification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    createRemoteJWKSetMock.mockClear();
    jwtVerifyMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(jwtVerifyMock).toHaveBeenCalledWith(token, expect.anything(), {
      algorithms: ["RS256"],
      issuer: "https://auth.example.com",
      audience: "web-client",
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
    const signatureError = new Error("signature failed") as Error & {
      code: string;
    };
    signatureError.name = "JWSSignatureVerificationFailed";
    signatureError.code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";

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
    const claimError = makeClaimValidationError("iss");

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
    const claimError = makeClaimValidationError("aud");

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
    const audError = makeClaimValidationError("aud");

    jwtVerifyMock
      .mockRejectedValueOnce(audError)
      .mockResolvedValueOnce({ payload: { sub: "123", client_id: "web" } });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web",
      allowClientIdClaimFallback: true,
    });

    expect(result).toEqual({
      ok: true,
      payload: { sub: "123", client_id: "web" },
    });
    expect(jwtVerifyMock).toHaveBeenNthCalledWith(1, token, expect.anything(), {
      algorithms: ["RS256"],
      issuer: "https://auth.example.com",
      audience: "web",
    });
    expect(jwtVerifyMock).toHaveBeenNthCalledWith(2, token, expect.anything(), {
      algorithms: ["RS256"],
      issuer: "https://auth.example.com",
    });
  });

  it("returns audience_mismatch when fallback client_id does not match", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const audError = makeClaimValidationError("aud");

    jwtVerifyMock.mockRejectedValueOnce(audError).mockResolvedValueOnce({
      payload: { sub: "123", client_id: "different-client" },
    });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web",
      allowClientIdClaimFallback: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "audience_mismatch",
      message: "Token audience fallback client_id mismatch",
    });
  });

  it("returns audience_mismatch when fallback token has no client_id", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const audError = makeClaimValidationError("aud");

    jwtVerifyMock
      .mockRejectedValueOnce(audError)
      .mockResolvedValueOnce({ payload: { sub: "123" } });

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web",
      allowClientIdClaimFallback: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "audience_mismatch",
      message: "Token audience fallback client_id mismatch",
    });
  });

  it("preserves strict audience mismatch when fallback verify throws", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const audError = makeClaimValidationError("aud");

    jwtVerifyMock
      .mockRejectedValueOnce(audError)
      .mockRejectedValueOnce(new Error("fallback verify failed"));

    const result = await verifyJwtWithJwks(token, {
      authServerUrl: "https://auth.example.com",
      clientId: "web",
      allowClientIdClaimFallback: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "audience_mismatch",
      message: "Token audience mismatch",
    });
  });

  it("returns invalid_token for malformed token before expiration check", async () => {
    const result = await verifyJwtWithJwks("not-a-jwt", {
      authServerUrl: "https://auth.example.com",
      clientId: "web-client",
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_token",
      message: "Token is malformed",
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("returns invalid_token instead of throwing for misconfigured authServerUrl", async () => {
    const result = await verifyJwtWithJwks(makeToken({ sub: "123" }), {
      authServerUrl: "http://auth.example.com",
      clientId: "web-client",
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_token",
      message: "authServerUrl must use https:// outside localhost",
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
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

describe("verifyAccessToken", () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
  });

  it("returns ok with typed payload on success", async () => {
    const token = makeToken({
      sub: "42",
      email: "test@f3.com",
      exp: 1_900_000_000,
    });

    jwtVerifyMock.mockResolvedValueOnce({
      payload: { sub: "42", email: "test@f3.com", exp: 1_900_000_000 },
    });

    const result = await verifyAccessToken(
      token,
      "https://auth.example.com",
      "web-client",
    );

    expect(result).toEqual({
      ok: true,
      payload: { sub: "42", email: "test@f3.com", exp: 1_900_000_000 },
    });
  });

  it("returns invalid_claims when payload sub is not a string", async () => {
    const token = makeToken({ sub: 42, exp: 1_900_000_000 });

    jwtVerifyMock.mockResolvedValueOnce({
      payload: { sub: 42, exp: 1_900_000_000 },
    });

    const result = await verifyAccessToken(
      token,
      "https://auth.example.com",
      "web-client",
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid_claims",
      error: "Token payload missing required sub claim",
    });
  });

  it("keeps client_id fallback opt-in by default", async () => {
    const token = makeToken({ sub: "123", exp: 1_900_000_000 });
    const audError = makeClaimValidationError("aud");

    jwtVerifyMock.mockRejectedValueOnce(audError).mockResolvedValueOnce({
      payload: { sub: "123", client_id: "web-client" },
    });

    const result = await verifyAccessToken(
      token,
      "https://auth.example.com",
      "web-client",
    );

    expect(result).toEqual({
      ok: false,
      code: "audience_mismatch",
      error: "Token audience mismatch",
    });
    expect(jwtVerifyMock).toHaveBeenCalledTimes(1);
  });
});
