// The /api/oauth/* adapters with AUTH_USE_BETTER_AUTH on, driven end to end
// against a real memoryAdapter Better Auth instance: packages/sso's request
// shapes in, tokens its verifier accepts out.
import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { verifyAccessToken } from "@f3nation/sso";

import type * as BetterAuthModule from "~/lib/better-auth";

import type { TestAuth } from "../../../lib/better-auth-fixture";
import {
  authorizeParams,
  BASE_URL,
  createFlowAuth,
  createMigratedClient,
  ENDPOINT,
  onboardedProfile,
  pkcePair,
  REDIRECT_URI,
  signIn,
} from "../../../lib/better-auth-fixture";

// Tokens carry the bare origin as iss.
const ISSUER = BASE_URL;

const envMock = {
  NEXT_PUBLIC_AUTH_URL: BASE_URL,
  AUTH_USE_BETTER_AUTH: true,
};
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/better-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthModule>()),
  getAuth: vi.fn(),
}));
vi.mock("~/lib/db", () => ({ db: {} }));
// The hand-rolled server, which none of these requests may reach. getClient
// is what lib/cors.ts reads the client's allowed origin from.
vi.mock("~/lib/oauth", () => ({
  getClient: vi.fn(),
  createAuthorizationCode: vi.fn(),
  validateRedirectUri: vi.fn(),
  validateScopes: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  exchangeRefreshToken: vi.fn(),
  validateAccessToken: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock("~/lib/current-session", () => ({ getCurrentSession: vi.fn() }));

const { deleteBetterAuthOAuthTokens, getAuth } =
  await import("~/lib/better-auth");
const oauth = await import("~/lib/oauth");
const { GET: authorize } =
  await import("../../../../src/app/api/oauth/authorize/route");
const { POST: token } =
  await import("../../../../src/app/api/oauth/token/route");
const { GET: userinfo } =
  await import("../../../../src/app/api/oauth/userinfo/route");
const { POST: revoke } =
  await import("../../../../src/app/api/oauth/revoke/route");
const { GET: oauthLogin } =
  await import("../../../../src/app/oauth/login/route");
const { GET: oauthOnboarding } =
  await import("../../../../src/app/oauth/onboarding/route");
const { GET: discovery } =
  await import("../../../../src/app/.well-known/openid-configuration/route");

const USER_ID = 4242;
const EMAIL = "flow@f3nation.test";

function asNext(request: Request) {
  return request as unknown as NextRequest;
}

function get(path: string, headers: Record<string, string> = {}) {
  return asNext(new Request(new URL(path, BASE_URL), { headers }));
}

function postForm(
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return asNext(
    new Request(new URL(path, BASE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

let auth: TestAuth;
let memoryDb: ReturnType<typeof createFlowAuth>["memoryDb"];
let profiles: ReturnType<typeof createFlowAuth>["profiles"];
let sessionToken: string;
let client: { clientId: string; clientSecret: string };

// One instance for the whole file: @f3nation/sso caches the JWKS it fetched
// per URL, so a second instance's keys wouldn't verify.
beforeAll(async () => {
  ({ auth, memoryDb, profiles } = createFlowAuth({ [EMAIL]: USER_ID }));
  profiles.set(USER_ID, onboardedProfile(EMAIL));
  sessionToken = await signIn(auth, EMAIL);
  client = await createMigratedClient(auth, sessionToken);
});

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = true;
  profiles.set(USER_ID, onboardedProfile(EMAIL));
  vi.mocked(getAuth).mockResolvedValue(auth);
});

/** /api/oauth/authorize as the signed-in user, returning the redirect. */
async function authorizeAs(params: URLSearchParams, session = sessionToken) {
  const res = await authorize(
    get(`/api/oauth/authorize?${params.toString()}`, {
      authorization: `Bearer ${session}`,
    }),
  );
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!, BASE_URL);
}

async function codeFor(extra: Record<string, string> = {}) {
  const pkce = pkcePair();
  const location = await authorizeAs(
    authorizeParams(client.clientId, pkce.challenge, extra),
  );
  expect(location.origin + location.pathname).toBe(REDIRECT_URI);
  const code = location.searchParams.get("code");
  expect(code).toBeTruthy();
  return { code: code!, verifier: pkce.verifier };
}

/** The exchange packages/sso makes: secret in the body, no resource. */
async function exchange(
  code: string,
  verifier: string,
  headers: Record<string, string> = {},
) {
  return token(
    postForm(
      "/api/oauth/token",
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code_verifier: verifier,
      },
      headers,
    ),
  );
}

interface TokenBody {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

async function tokens(extra: Record<string, string> = {}) {
  const { code, verifier } = await codeFor(extra);
  const res = await exchange(code, verifier);
  expect(res.status).toBe(200);
  return (await res.json()) as TokenBody;
}

async function verifyLikeAdmin(accessToken: string) {
  const jwks = await auth.api.getJwks();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        String(input instanceof Request ? input.url : input) ===
          `${BASE_URL}/.well-known/jwks.json`
          ? Response.json(jwks)
          : new Response(null, { status: 404 }),
      ),
    ),
  );
  try {
    return await verifyAccessToken(
      accessToken,
      BASE_URL,
      client.clientId,
      true,
    );
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("/api/oauth/* through Better Auth", () => {
  it("issues a JWT access token packages/sso verifies, though neither request sends a resource", async () => {
    const body = await tokens();

    expect(body.access_token.split(".")).toHaveLength(3);
    const payload = decodeJwt(body.access_token);
    expect(payload.iss).toBe(ISSUER);
    expect(payload.sub).toBe(String(USER_ID));
    expect(payload.aud).toContain(ISSUER);
    expect(await verifyLikeAdmin(body.access_token)).toMatchObject({
      ok: true,
    });
    expect(oauth.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(oauth.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("puts the F3 profile in the id_token, marked token_use id", async () => {
    const body = await tokens();

    const idToken = decodeJwt(body.id_token!);
    expect(idToken).toMatchObject({
      token_use: "id",
      name: "Tackle",
      picture: "https://cdn.example.com/tackle.png",
      email: EMAIL,
      email_verified: true,
    });
    // One hour, like signIdToken, not Better Auth's 10h default.
    expect(idToken.exp! - idToken.iat!).toBe(3600);
  });

  it("leaves null profile fields out of the id_token", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      f3Name: null,
      avatarUrl: null,
    });
    const idToken = decodeJwt((await tokens()).id_token!);
    expect(idToken).not.toHaveProperty("name");
    expect(idToken).not.toHaveProperty("picture");
  });

  it("drops an empty nonce instead of echoing it into the id_token", async () => {
    const withEmpty = decodeJwt((await tokens({ nonce: "" })).id_token!);
    expect(withEmpty).not.toHaveProperty("nonce");

    const withNonce = decodeJwt((await tokens({ nonce: "n-123" })).id_token!);
    expect(withNonce.nonce).toBe("n-123");
  });

  it("refreshes with offline_access, and the refreshed token is still a JWT", async () => {
    const first = await tokens();
    expect(first.refresh_token).toBeTruthy();

    const res = await token(
      postForm("/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token!,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    );
    expect(res.status).toBe(200);
    const refreshed = (await res.json()) as TokenBody;
    expect(await verifyLikeAdmin(refreshed.access_token)).toMatchObject({
      ok: true,
    });
    expect(oauth.exchangeRefreshToken).not.toHaveBeenCalled();
  });

  it("rejects a wrong client_secret_post secret", async () => {
    const { code, verifier } = await codeFor();
    const res = await token(
      postForm("/api/oauth/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: client.clientId,
        client_secret: "not-the-secret",
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_client" });
  });

  it("adds the client's CORS headers to the token response", async () => {
    vi.mocked(oauth.getClient).mockResolvedValue({
      allowedOrigin: "https://app.example.com",
    } as never);
    const { code, verifier } = await codeFor();

    const res = await exchange(code, verifier, {
      origin: "https://app.example.com",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(oauth.getClient).toHaveBeenCalledWith(client.clientId);
  });

  it("serves userinfo from the F3 users row", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      avatarUrl: null,
    });
    const body = await tokens();

    const res = await userinfo(
      get("/api/oauth/userinfo", {
        authorization: `Bearer ${body.access_token}`,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sub: String(USER_ID),
      name: "Tackle",
      picture: null,
      email: EMAIL,
      email_verified: true,
    });
    expect(oauth.validateAccessToken).not.toHaveBeenCalled();
  });

  it("returns 401 invalid_token from userinfo when the users row is gone", async () => {
    const body = await tokens();
    profiles.delete(USER_ID);

    const res = await userinfo(
      get("/api/oauth/userinfo", {
        authorization: `Bearer ${body.access_token}`,
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_token" });
  });

  it("authenticates a token request whose credentials are only in a Basic header", async () => {
    const { code, verifier } = await codeFor();
    const basic = Buffer.from(
      `${client.clientId}:${client.clientSecret}`,
    ).toString("base64");

    const res = await token(
      postForm(
        "/api/oauth/token",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        },
        { authorization: `Basic ${basic}` },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      access_token: expect.any(String) as string,
    });
  });

  it("rejects a revoke with no client credentials", async () => {
    const body = await tokens();

    const res = await revoke(
      postForm("/api/oauth/revoke", { token: body.refresh_token! }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(oauth.revokeToken).not.toHaveBeenCalled();
  });

  it("revokes a refresh token for an authenticated client", async () => {
    const body = await tokens();

    const res = await revoke(
      postForm("/api/oauth/revoke", {
        token: body.refresh_token!,
        token_type_hint: "refresh_token",
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    );

    expect(res.status).toBe(200);
    expect(oauth.revokeToken).not.toHaveBeenCalled();

    // The revoked token can't be refreshed.
    const refresh = await token(
      postForm("/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: body.refresh_token!,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    );
    expect(refresh.status).toBe(400);
  });

  it("logout's token cleanup leaves no refresh token to use", async () => {
    const body = await tokens();
    expect(memoryDb.oauthRefreshToken).not.toHaveLength(0);

    await deleteBetterAuthOAuthTokens(auth, String(USER_ID));

    expect(memoryDb.oauthRefreshToken).toHaveLength(0);
    const res = await token(
      postForm("/api/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: body.refresh_token!,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("login and onboarding round-trip through /api/oauth/authorize", () => {
  function callbackFrom(location: string) {
    const url = new URL(location, BASE_URL);
    return new URL(url.searchParams.get("callbackUrl")!);
  }

  it("authorizes a browser by its session cookie alone, with no bearer header", async () => {
    const signInResponse = await auth.api.signInEmailOTP({
      body: {
        email: EMAIL,
        otp: await auth.api.createVerificationOTP({
          body: { email: EMAIL, type: "sign-in" },
        }),
      },
      asResponse: true,
    });
    const cookie = signInResponse.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");

    const res = await authorize(
      get(
        `/api/oauth/authorize?${authorizeParams(client.clientId, pkcePair().challenge).toString()}`,
        { cookie },
      ),
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, BASE_URL);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("sends a signed-out user to /login/email with the authorize URL as callbackUrl", async () => {
    const pkce = pkcePair();
    const res = await authorize(
      get(
        `/api/oauth/authorize?${authorizeParams(client.clientId, pkce.challenge, { prompt: "login", max_age: "60" }).toString()}`,
      ),
    );
    const pageUrl = res.headers.get("location")!;
    expect(pageUrl.startsWith("/oauth/login?")).toBe(true);

    const login = await oauthLogin(get(pageUrl));
    const location = login.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/login/email");

    const callback = callbackFrom(location);
    expect(callback.origin + callback.pathname).toBe(
      `${BASE_URL}/api/oauth/authorize`,
    );
    for (const name of ["sig", "exp", "ba_iat", "ba_pl", "ba_param"]) {
      expect(callback.searchParams.has(name)).toBe(false);
    }
    // Satisfied by signing in; left in they'd loop back to the login page.
    expect(callback.searchParams.has("prompt")).toBe(false);
    expect(callback.searchParams.has("max_age")).toBe(false);
    expect(callback.searchParams.get("client_id")).toBe(client.clientId);
    expect(callback.searchParams.get("state")).toBe("rp-state");
  });

  it("gates a user who hasn't onboarded, then issues a code once they have", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      onboardingCompleted: false,
    });
    const pkce = pkcePair();

    const gated = await authorizeAs(
      authorizeParams(client.clientId, pkce.challenge),
    );
    expect(gated.pathname).toBe("/oauth/onboarding");
    expect(gated.searchParams.has("code")).toBe(false);

    const onboarding = await oauthOnboarding(get(gated.toString()));
    const location = onboarding.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/onboarding");
    const callback = callbackFrom(location);

    // Still not onboarded: the callback just lands back on the gate.
    expect((await authorizeAs(callback.searchParams)).pathname).toBe(
      "/oauth/onboarding",
    );

    profiles.set(USER_ID, onboardedProfile(EMAIL));
    const done = await authorizeAs(callback.searchParams);
    expect(done.origin + done.pathname).toBe(REDIRECT_URI);
    expect(done.searchParams.get("code")).toBeTruthy();
    expect(done.searchParams.get("state")).toBe("rp-state");
  });

  it("treats a user with no users row as not onboarded", async () => {
    profiles.delete(USER_ID);
    const location = await authorizeAs(
      authorizeParams(client.clientId, pkcePair().challenge),
    );
    expect(location.pathname).toBe("/oauth/onboarding");
  });

  it("answers prompt=none with interaction_required instead of the onboarding page", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      onboardingCompleted: false,
    });
    const location = await authorizeAs(
      authorizeParams(client.clientId, pkcePair().challenge, {
        prompt: "none",
      }),
    );
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("interaction_required");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("can't be skipped by telling /oauth2/continue the signup is done", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      onboardingCompleted: false,
    });
    const gated = await authorizeAs(
      authorizeParams(client.clientId, pkcePair().challenge),
    );

    const res = await auth.handler(
      new Request(`${ENDPOINT}/oauth2/continue`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          created: true,
          oauth_query: gated.search.slice(1),
        }),
      }),
    );

    const body = (await res.json()) as { url?: string };
    expect(body.url).toBeDefined();
    const next = new URL(body.url!, BASE_URL);
    expect(next.pathname).toBe("/oauth/onboarding");
    expect(next.searchParams.has("code")).toBe(false);
  });

  it("refuses a page request whose signature doesn't verify", async () => {
    profiles.set(USER_ID, {
      ...onboardedProfile(EMAIL),
      onboardingCompleted: false,
    });
    const gated = await authorizeAs(
      authorizeParams(client.clientId, pkcePair().challenge),
    );
    gated.searchParams.set("redirect_uri", "https://attacker.example.com/cb");

    const res = await oauthOnboarding(get(gated.toString()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("404s the page routes while the flag is off", async () => {
    envMock.AUTH_USE_BETTER_AUTH = false;
    expect((await oauthLogin(get("/oauth/login"))).status).toBe(404);
    expect((await oauthOnboarding(get("/oauth/onboarding"))).status).toBe(404);
    expect(getAuth).not.toHaveBeenCalled();
  });
});

describe("/.well-known/openid-configuration with the flag on", () => {
  it("serves Better Auth's metadata with the bare-origin issuer and the root JWKS", async () => {
    const res = await discovery(
      new Request(`${BASE_URL}/.well-known/openid-configuration`),
    );
    const metadata = (await res.json()) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      issuer: ISSUER,
      jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
      authorization_endpoint: `${ENDPOINT}/oauth2/authorize`,
      token_endpoint: `${ENDPOINT}/oauth2/token`,
      userinfo_endpoint: `${ENDPOINT}/oauth2/userinfo`,
      revocation_endpoint: `${ENDPOINT}/oauth2/revoke`,
      end_session_endpoint: `${BASE_URL}/api/oauth/logout`,
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata.scopes_supported).toContain("offline_access");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
    );
  });
});
