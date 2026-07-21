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
  getJWKS: vi.fn(async () => ({ keys: [] })),
}));

const { exchangeAuthorizationCode, exchangeRefreshToken } =
  await import("../../src/lib/oauth");
const { logWarn } = await import("~/lib/logging");

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
