import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthClient,
  AuthError,
  createOAuthLoginFlowArtifacts,
  createOAuthState,
  isOAuthStateExpired,
  isSafeReturnPath,
  parseOAuthState,
} from "./index";

describe("OAuth state helpers", () => {
  it("round-trips createOAuthState -> parseOAuthState", () => {
    const payload = {
      csrfToken: "csrf-token",
      returnTo: "/profile/settings",
      timestamp: 1_700_000_000_000,
    };

    const encoded = createOAuthState(payload);
    expect(parseOAuthState(encoded)).toEqual(payload);
  });

  it("rejects malformed payload shapes", () => {
    const missingField = Buffer.from(
      JSON.stringify({ csrfToken: "x", returnTo: "/profile" }),
      "utf-8",
    ).toString("base64url");

    expect(parseOAuthState(missingField)).toBeNull();
    expect(parseOAuthState("not-base64url")).toBeNull();
  });

  it("rejects non-finite timestamps", () => {
    const invalidTimestamp = Buffer.from(
      JSON.stringify({
        csrfToken: "x",
        returnTo: "/profile",
        timestamp: Number.NaN,
      }),
      "utf-8",
    ).toString("base64url");

    expect(parseOAuthState(invalidTimestamp)).toBeNull();
  });

  it("rejects unsafe returnTo values during parse", () => {
    const unsafeState = Buffer.from(
      JSON.stringify({
        csrfToken: "x",
        returnTo: "//evil.test",
        timestamp: 1_700_000_000_000,
      }),
      "utf-8",
    ).toString("base64url");

    expect(parseOAuthState(unsafeState)).toBeNull();
  });
});

describe("return path validation", () => {
  it("accepts known-safe local paths", () => {
    expect(isSafeReturnPath("/")).toBe(true);
    expect(isSafeReturnPath("/profile")).toBe(true);
    expect(isSafeReturnPath("/profile/settings")).toBe(true);
  });

  it("rejects protocol-relative, backslash, and control characters", () => {
    expect(isSafeReturnPath("//evil.test")).toBe(false);
    expect(isSafeReturnPath("/\\evil.test")).toBe(false);
    expect(isSafeReturnPath("/profile\nadmin")).toBe(false);
    expect(isSafeReturnPath("/profile\radmin")).toBe(false);
    expect(isSafeReturnPath("/profile\tadmin")).toBe(false);
  });
});

describe("OAuth state expiration", () => {
  it("uses an inclusive boundary at maxAgeMs", () => {
    const state = { timestamp: 1_000 };

    expect(isOAuthStateExpired(state, 100, 1_099)).toBe(false);
    expect(isOAuthStateExpired(state, 100, 1_100)).toBe(true);
  });
});

describe("OAuth login flow artifacts", () => {
  it("generates a PKCE challenge that matches SHA-256(codeVerifier)", async () => {
    const artifacts = await createOAuthLoginFlowArtifacts({
      returnTo: "/profile",
      timestamp: 1_700_000_000_000,
    });

    const expectedChallenge = createHash("sha256")
      .update(artifacts.codeVerifier)
      .digest("base64url");

    expect(artifacts.codeChallenge).toBe(expectedChallenge);

    const parsedState = parseOAuthState(artifacts.state);
    expect(parsedState).toEqual({
      csrfToken: artifacts.csrfToken,
      returnTo: "/profile",
      timestamp: 1_700_000_000_000,
    });
  });
});

describe("AuthClient.exchangeCodeForToken", () => {
  const client = new AuthClient({
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "https://app.test/callback",
    authServerUrl: "https://auth.test",
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AuthError when the 200 response omits access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token_type: "Bearer" }),
      }),
    );

    await expect(
      client.exchangeCodeForToken({ code: "code", codeVerifier: "verifier" }),
    ).rejects.toThrow(AuthError);

    await expect(
      client.exchangeCodeForToken({ code: "code", codeVerifier: "verifier" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("AuthClient.refreshToken", () => {
  const client = new AuthClient({
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "https://app.test/callback",
    authServerUrl: "https://auth.test",
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AuthError when the 200 response omits access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token_type: "Bearer" }),
      }),
    );

    await expect(
      client.refreshToken({ refreshToken: "rt" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
