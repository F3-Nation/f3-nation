import crypto from "crypto";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { isValidRedirectUri } from "../../scripts/add-client";

// ---------------------------------------------------------------------------
// db mock — a chainable object that resolves to a queued value no matter
// which drizzle query-builder methods get called on the way, so tests can
// just set up `select`/`delete`/`insert` return values per call.
// ---------------------------------------------------------------------------

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of [
    "from",
    "where",
    "limit",
    "returning",
    "values",
    "set",
    "orderBy",
  ]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  obj.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve(result).catch(reject);
  return obj;
}

const dbMock = {
  select: vi.fn(() => chain([])),
  delete: vi.fn(() => chain([])),
  update: vi.fn(() => chain([])),
  insert: vi.fn(() => chain(undefined)),
  transaction: vi.fn(async (cb: (tx: typeof dbMock) => unknown) => cb(dbMock)),
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/logging", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("~/lib/jwt", () => ({
  signAccessToken: vi.fn(async () => "signed.jwt.token"),
  getJWKS: vi.fn(async () => ({ keys: [{ kty: "RSA" }] })),
}));
vi.mock("jose", () => ({
  importJWK: vi.fn(async () => "mock-public-key"),
  jwtVerify: vi.fn(),
}));

const {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  createAuthorizationCode,
  validateRedirectUri,
  validateScopes,
  validateAccessToken,
  revokeToken,
  revokeAllUserTokens,
  cleanupRotatedRefreshTokens,
} = await import("../../src/lib/oauth");
const { logWarn, logError } = await import("~/lib/logging");
const { jwtVerify } = await import("jose");

const CONFIDENTIAL_CLIENT = {
  id: "confidential-client",
  name: "Confidential Client",
  clientSecretHash:
    // sha256("correct-secret")
    "6b3dcb3a05c65bd3b0f6e2f1c1c7e0f9f0a1e0f5e1e5b3c3a1e0f5e1e5b3c3a1",
  redirectUris: JSON.stringify(["https://example.com/callback"]),
  allowedOrigin: "https://example.com",
  scopes: "openid profile email",
  createdAt: "",
  isActive: true,
  isPublic: false,
};

const PUBLIC_CLIENT = {
  ...CONFIDENTIAL_CLIENT,
  id: "public-client",
  isPublic: true,
};

function mockGetClientResult(client: typeof CONFIDENTIAL_CLIENT | null) {
  dbMock.select.mockReturnValueOnce(chain(client ? [client] : []));
}

beforeEach(() => {
  vi.clearAllMocks();
  // .mockReset() (not just clearAllMocks above) on dbMock's own methods —
  // clearAllMocks only wipes call history and leaves any queued
  // mockReturnValueOnce() values in place, so a test that queues more
  // once-values than its code path consumes leaks them into the next
  // test's first calls. Scoped to dbMock so the module-level mocks for
  // signAccessToken/getJWKS/jwtVerify/importJWK (set once in the vi.mock
  // factories above, not reinstated per-test) aren't wiped too.
  dbMock.select.mockReset();
  dbMock.delete.mockReset();
  dbMock.update.mockReset();
  dbMock.insert.mockReset();
  dbMock.transaction.mockReset();
  dbMock.select.mockImplementation(() => chain([]));
  dbMock.delete.mockImplementation(() => chain([]));
  dbMock.update.mockImplementation(() => chain([]));
  dbMock.insert.mockImplementation(() => chain(undefined));
  dbMock.transaction.mockImplementation(async (cb) => cb(dbMock));
});

describe("exchangeAuthorizationCode", () => {
  it("rejects a confidential client with a missing secret", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: CONFIDENTIAL_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(CONFIDENTIAL_CLIENT);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: CONFIDENTIAL_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("rejects a confidential client with the wrong secret", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: CONFIDENTIAL_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(CONFIDENTIAL_CLIENT);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: CONFIDENTIAL_CLIENT.id,
      clientSecret: "totally-wrong",
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("rejects a public client with a missing PKCE verifier", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("rejects a public client with a wrong PKCE verifier", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge-that-wont-match",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "wrong-verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("warns (but does not reject) when a public client sends a secret anyway", async () => {
    const computedChallenge = "challenge-for-secret-warn-test";
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: computedChallenge,
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);

    // Verifier won't match the challenge — we only care that it gets past
    // client auth and logs the anomaly, not that the exchange succeeds.
    await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      clientSecret: "unexpected-secret",
      redirectUri: "https://example.com/callback",
      codeVerifier: "some-verifier",
    });

    expect(logWarn).toHaveBeenCalledWith(
      "auth.oauth.public_client_sent_secret",
      { clientId: PUBLIC_CLIENT.id },
    );
  });

  it("rejects an unknown authorization code", async () => {
    dbMock.delete.mockReturnValueOnce(chain([]));

    const result = await exchangeAuthorizationCode({
      code: "no-such-code",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("rejects an expired authorization code", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("rejects a code issued to a different client", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: "some-other-client",
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("rejects a redirect URI that doesn't match the one the code was issued with", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/original-callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/different-callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("rejects an unknown client", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: "ghost-client",
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: "challenge",
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(null);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: "ghost-client",
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("rejects a code with no PKCE challenge stored", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: null,
          codeChallengeMethod: null,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: "verifier",
    });

    expect(result).toEqual({ error: "invalid_grant" });
  });

  it("returns invalid_grant (and logs) when the code's user no longer exists", async () => {
    const verifier = "verifier-for-missing-user-test";
    const computedChallenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 999,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: computedChallenge,
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);
    dbMock.select.mockReturnValueOnce(chain([])); // user lookup finds nothing

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: verifier,
    });

    expect(result).toEqual({ error: "invalid_grant" });
    expect(logError).toHaveBeenCalledWith("auth.oauth.user_not_found", {
      clientId: PUBLIC_CLIENT.id,
      grantType: "authorization_code",
      userId: 999,
    });
  });

  it("completes a full public-client exchange end to end", async () => {
    // PKCE S256: challenge = base64url(sha256(verifier))
    const verifier = "a-real-looking-code-verifier-string";
    const computedChallenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    dbMock.delete.mockReturnValueOnce(
      chain([
        {
          code: "code-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 1,
          redirectUri: "https://example.com/callback",
          scopes: "openid profile email",
          codeChallenge: computedChallenge,
          codeChallengeMethod: "S256",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
        },
      ]),
    );
    mockGetClientResult(PUBLIC_CLIENT);
    dbMock.select.mockReturnValueOnce(chain([{ email: "pax@example.com" }]));

    const result = await exchangeAuthorizationCode({
      code: "code-1",
      clientId: PUBLIC_CLIENT.id,
      redirectUri: "https://example.com/callback",
      codeVerifier: verifier,
    });

    expect(result).toMatchObject({
      access_token: "signed.jwt.token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email",
    });
    expect(typeof (result as { refresh_token: unknown }).refresh_token).toBe(
      "string",
    );
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });
});

describe("exchangeRefreshToken", () => {
  it("rejects a confidential client with a missing secret", async () => {
    mockGetClientResult(CONFIDENTIAL_CLIENT);

    const result = await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: CONFIDENTIAL_CLIENT.id,
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("rejects a confidential client with the wrong secret", async () => {
    mockGetClientResult(CONFIDENTIAL_CLIENT);

    const result = await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: CONFIDENTIAL_CLIENT.id,
      clientSecret: "totally-wrong",
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("rejects an unknown refresh token with no reuse signal", async () => {
    mockGetClientResult(PUBLIC_CLIENT);
    // The UPDATE ... RETURNING (rotation) finds nothing, and the follow-up
    // SELECT for a stale/rotated row also finds nothing (default mock) —
    // this is a garbage token that was never issued, not a replay.
    dbMock.update.mockReturnValueOnce(chain([]));

    const result = await exchangeRefreshToken({
      refreshToken: "never-issued-token",
      clientId: PUBLIC_CLIENT.id,
    });

    expect(result).toEqual({ error: "invalid_grant" });
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("detects replay of an already-rotated refresh token and revokes the family", async () => {
    mockGetClientResult(PUBLIC_CLIENT);
    // The UPDATE ... RETURNING (rotation) finds nothing — this exact token
    // was already consumed by an earlier request. The follow-up SELECT
    // finds the row (rotatedAt set from that earlier rotation), which is
    // what marks this as a genuine replay rather than a garbage token.
    dbMock.update.mockReturnValueOnce(chain([]));
    dbMock.select.mockReturnValueOnce(chain([{ userId: 42 }]));

    const result = await exchangeRefreshToken({
      refreshToken: "already-used-token",
      clientId: PUBLIC_CLIENT.id,
    });

    expect(result).toEqual({ error: "invalid_grant" });
    expect(logWarn).toHaveBeenCalledWith(
      "auth.oauth.refresh_token_reuse_detected",
      { clientId: PUBLIC_CLIENT.id, userId: 42 },
    );
    // The whole token family for that user+client is revoked, not just the
    // replayed token.
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  it("rotates a valid public-client refresh token and issues a new one", async () => {
    mockGetClientResult(PUBLIC_CLIENT);
    dbMock.update.mockReturnValueOnce(
      chain([
        {
          token: "rt-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 42,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
          rotatedAt: new Date().toISOString(),
        },
      ]),
    );
    dbMock.select.mockReturnValueOnce(chain([{ email: "pax@example.com" }]));

    const result = await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: PUBLIC_CLIENT.id,
    });

    expect(result).not.toHaveProperty("error");
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("warns (but does not reject) when a public client sends a secret anyway", async () => {
    mockGetClientResult(PUBLIC_CLIENT);
    dbMock.update.mockReturnValueOnce(chain([]));

    await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: PUBLIC_CLIENT.id,
      clientSecret: "unexpected-secret",
    });

    expect(logWarn).toHaveBeenCalledWith(
      "auth.oauth.public_client_sent_secret",
      { clientId: PUBLIC_CLIENT.id },
    );
  });

  it("rejects an unknown client", async () => {
    mockGetClientResult(null);

    const result = await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: "ghost-client",
    });

    expect(result).toEqual({ error: "invalid_client" });
  });

  it("returns invalid_grant (and logs) when the token's user no longer exists", async () => {
    mockGetClientResult(PUBLIC_CLIENT);
    dbMock.update.mockReturnValueOnce(
      chain([
        {
          token: "rt-1",
          clientId: PUBLIC_CLIENT.id,
          userId: 999,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: "",
          rotatedAt: new Date().toISOString(),
        },
      ]),
    );
    dbMock.select.mockReturnValueOnce(chain([])); // user lookup finds nothing

    const result = await exchangeRefreshToken({
      refreshToken: "rt-1",
      clientId: PUBLIC_CLIENT.id,
    });

    expect(result).toEqual({ error: "invalid_grant" });
    expect(logError).toHaveBeenCalledWith("auth.oauth.user_not_found", {
      clientId: PUBLIC_CLIENT.id,
      grantType: "refresh_token",
      userId: 999,
    });
  });
});

describe("createAuthorizationCode", () => {
  it("inserts a new authorization code row and returns the code", async () => {
    const code = await createAuthorizationCode({
      clientId: PUBLIC_CLIENT.id,
      userId: 1,
      redirectUri: "https://example.com/callback",
      scopes: "openid profile email",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });

    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });
});

describe("validateRedirectUri", () => {
  it("accepts a URI present in the client's redirect URI list", () => {
    expect(
      validateRedirectUri(CONFIDENTIAL_CLIENT, "https://example.com/callback"),
    ).toBe(true);
  });

  it("rejects a URI not present in the client's redirect URI list", () => {
    expect(
      validateRedirectUri(CONFIDENTIAL_CLIENT, "https://evil.example/callback"),
    ).toBe(false);
  });

  it("rejects malformed JSON in the stored redirect URIs", () => {
    expect(
      validateRedirectUri(
        { ...CONFIDENTIAL_CLIENT, redirectUris: "{not-json" },
        "https://example.com/callback",
      ),
    ).toBe(false);
  });

  it("rejects a redirectUris value that parses but isn't an array", () => {
    expect(
      validateRedirectUri(
        { ...CONFIDENTIAL_CLIENT, redirectUris: '{"not":"an array"}' },
        "https://example.com/callback",
      ),
    ).toBe(false);
  });
});

describe("validateScopes", () => {
  it("accepts scopes that are all in the client's allowed list", () => {
    expect(validateScopes(CONFIDENTIAL_CLIENT, "openid profile")).toBe(true);
  });

  it("rejects a requested scope not in the client's allowed list", () => {
    expect(validateScopes(CONFIDENTIAL_CLIENT, "openid admin")).toBe(false);
  });

  it("falls back to the default scope set when the client has none configured", () => {
    expect(
      validateScopes({ ...CONFIDENTIAL_CLIENT, scopes: null }, "openid email"),
    ).toBe(true);
  });
});

describe("validateAccessToken", () => {
  it("returns null when the JWT fails verification", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("bad signature"));

    const result = await validateAccessToken("garbage-token");

    expect(result).toBeNull();
  });

  it("returns null when the token has no usable subject", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: undefined },
      protectedHeader: {},
    } as never);

    const result = await validateAccessToken("token-with-no-sub");

    expect(result).toBeNull();
  });

  it("returns null when the token's user no longer exists", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "42", scope: "openid", client_id: PUBLIC_CLIENT.id },
      protectedHeader: {},
    } as never);
    dbMock.select.mockReturnValueOnce(chain([]));

    const result = await validateAccessToken("token-for-deleted-user");

    expect(result).toBeNull();
  });

  it("returns the userinfo payload for a valid token", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "42", scope: "openid", client_id: PUBLIC_CLIENT.id },
      protectedHeader: {},
    } as never);
    dbMock.select.mockReturnValueOnce(
      chain([
        {
          id: 42,
          f3Name: "PermVac",
          email: "pax@example.com",
          emailVerified: true,
          avatarUrl: null,
        },
      ]),
    );

    const result = await validateAccessToken("a-valid-token");

    expect(result).toEqual({
      token: "a-valid-token",
      userId: 42,
      scopes: "openid",
      clientId: PUBLIC_CLIENT.id,
      user: {
        id: 42,
        f3Name: "PermVac",
        email: "pax@example.com",
        emailVerified: true,
        avatarUrl: null,
      },
    });
  });
});

describe("revokeToken", () => {
  it("deletes the refresh token row when it exists", async () => {
    dbMock.select.mockReturnValueOnce(chain([{ token: "rt-1" }]));

    await revokeToken("rt-1");

    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the token doesn't exist", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));

    await revokeToken("never-issued");

    expect(dbMock.delete).not.toHaveBeenCalled();
  });
});

describe("revokeAllUserTokens", () => {
  it("deletes every refresh token for the user", async () => {
    await revokeAllUserTokens(42);

    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupRotatedRefreshTokens", () => {
  it("deletes rotated rows past the retention window and returns the count", async () => {
    dbMock.delete.mockReturnValueOnce(
      chain([{ token: "rt-old-1" }, { token: "rt-old-2" }]),
    );

    const count = await cleanupRotatedRefreshTokens();

    expect(count).toBe(2);
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when nothing is past the retention window", async () => {
    dbMock.delete.mockReturnValueOnce(chain([]));

    const count = await cleanupRotatedRefreshTokens();

    expect(count).toBe(0);
  });
});

describe("isValidRedirectUri", () => {
  it("accepts https and localhost URIs for confidential clients", () => {
    expect(isValidRedirectUri("https://example.com/callback", false)).toBe(
      true,
    );
    expect(isValidRedirectUri("http://localhost:3000/callback", false)).toBe(
      true,
    );
  });

  it("rejects plain http (non-localhost) for confidential clients", () => {
    expect(isValidRedirectUri("http://example.com/callback", false)).toBe(
      false,
    );
  });

  it("accepts a reverse-domain custom scheme with no authority for public clients", () => {
    expect(isValidRedirectUri("com.example.app:/oauth2redirect", true)).toBe(
      true,
    );
  });

  it("rejects a custom scheme with a spoofed authority for public clients", () => {
    expect(
      isValidRedirectUri("com.example.app://attacker/callback", true),
    ).toBe(false);
  });

  it("rejects a custom scheme without a dot (not reverse-domain) for public clients", () => {
    expect(isValidRedirectUri("foo:/callback", true)).toBe(false);
  });

  it("rejects custom schemes entirely for confidential clients", () => {
    expect(isValidRedirectUri("com.example.app:/callback", false)).toBe(false);
  });
});
