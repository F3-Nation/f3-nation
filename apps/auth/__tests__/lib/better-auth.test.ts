import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { getAuthTables } from "@better-auth/core/db";
import { isAccessTokenPayload } from "@f3nation/sso";

import {
  buildBetterAuthOptions,
  createAuthInstance,
  memoryAdapter,
} from "../../src/lib/better-auth";
import type { MemoryDB } from "../../src/lib/better-auth";

const BASE_URL = "http://localhost:3999";
const BASE_PATH = "/api/auth2";
const ISSUER = `${BASE_URL}${BASE_PATH}`;
const REDIRECT_URI = "https://phase3-client.example.com/callback";
const PUBLIC_REDIRECT_URI = "com.f3nation.phase3test:/oauth2redirect";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// memoryAdapter throws on any findOne() against a model whose array key is
// entirely absent from the backing object, rather than returning "not
// found", hence the pre-seeding loop below.
// The fixed numeric id models "this email already has a real F3 users
// row" — findF3UserId returning non-null is what lets
// databaseHooks.user.create.before allow the sign-in through at all (see
// apps/auth/src/lib/better-auth.ts's comment on why this can't be
// emailOTP's own disableSignUp).
function createTestAuth(f3UserId: number | null) {
  const memoryDb: MemoryDB = {};
  const options = {
    baseURL: BASE_URL,
    basePath: BASE_PATH,
    secret: "test-only-not-a-real-secret",
    issuer: ISSUER,
    database: memoryAdapter(memoryDb),
    sendVerificationOTP: () => Promise.resolve(),
    findF3UserId: () => Promise.resolve(f3UserId),
  };
  const authOptions = buildBetterAuthOptions(options);
  for (const table of Object.keys(getAuthTables(authOptions))) {
    memoryDb[table] ??= [];
  }
  return createAuthInstance(options);
}

async function signInAndGetToken(
  auth: ReturnType<typeof createTestAuth>,
  email: string,
) {
  const otp = await auth.api.createVerificationOTP({
    body: { email, type: "sign-in" },
  });
  const signIn = await auth.api.signInEmailOTP({ body: { email, otp } });
  expect(signIn.token).toBeTruthy();
  return signIn.token;
}

async function authorizeAndExchange(
  auth: ReturnType<typeof createTestAuth>,
  params: {
    sessionToken: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    scope: string;
  },
) {
  const authHeaders = { authorization: `Bearer ${params.sessionToken}` };
  const pkce = pkcePair();

  const authorizeUrl = new URL(`${ISSUER}/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", params.clientId);
  authorizeUrl.searchParams.set("redirect_uri", params.redirectUri);
  authorizeUrl.searchParams.set("scope", params.scope);
  authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "phase3-test-state");
  authorizeUrl.searchParams.set("resource", ISSUER);

  const authorize = await auth.handler(
    new Request(authorizeUrl, { headers: authHeaders }),
  );
  const authorizeLocation = authorize.headers.get("location");
  expect(authorizeLocation).toBeTruthy();
  const oauthQuery = authorizeLocation!.split("?")[1]!;

  const consent = await auth.handler(
    new Request(`${ISSUER}/oauth2/consent`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    }),
  );
  const consentBody = (await consent.clone().json()) as { url: string };
  const code = new URL(consentBody.url).searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code: code!,
    redirect_uri: params.redirectUri,
    code_verifier: pkce.verifier,
    resource: ISSUER,
    client_id: params.clientId,
  });

  const tokenHeaders: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (params.clientSecret) {
    const basicAuth = Buffer.from(
      `${params.clientId}:${params.clientSecret}`,
    ).toString("base64");
    tokenHeaders.authorization = `Basic ${basicAuth}`;
  }

  const tokenResponse = await auth.handler(
    new Request(`${ISSUER}/oauth2/token`, {
      method: "POST",
      headers: tokenHeaders,
      body: tokenParams.toString(),
    }),
  );
  expect(tokenResponse.status).toBe(200);
  return (await tokenResponse.json()) as {
    access_token: string;
    id_token?: string;
    token_type: string;
  };
}

describe("Better Auth instance (#876 Phase 3) — apps/auth/src/lib/better-auth.ts", () => {
  it("issues a confidential-client access token with the real numeric user id as sub", async () => {
    const email = "phase3-confidential@f3nation.test";
    const auth = createTestAuth(4242);
    const sessionToken = await signInAndGetToken(auth, email);
    const authHeaders = { authorization: `Bearer ${sessionToken}` };

    const client = await auth.api.createOAuthClient({
      headers: authHeaders,
      body: {
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "web",
        scope: "openid profile email offline_access",
      },
    });
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeTruthy();

    const tokenBody = await authorizeAndExchange(auth, {
      sessionToken,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      redirectUri: REDIRECT_URI,
      scope: "openid profile email offline_access",
    });

    const payload = decodeJwt(tokenBody.access_token);
    const header = decodeProtectedHeader(tokenBody.access_token);

    // The real production verifier — @f3nation/sso — not a reimplementation.
    expect(isAccessTokenPayload(payload)).toBe(true);
    expect(payload.token_use).toBe("access");
    // The bridged identity, not a Better Auth-internal id — this is the
    // exact parity question the Phase 1 spike left open ("Phase 3, wired to
    // the real DB, is where sub becomes the real numeric-string id again").
    expect(payload.sub).toBe("4242");
    expect(payload.email).toBe(email);
    expect(typeof payload.client_id).toBe("string");
    expect(header.alg).toBe("RS256");

    // id_token issuance, matching apps/auth/src/lib/oauth.ts's
    // idTokenScopeOrNull gate (only issued when openid was granted).
    expect(tokenBody.id_token).toBeTruthy();
  });

  it("issues a public/PKCE-only client's access token with no client_secret exchanged — the case the Phase 1 spike didn't cover", async () => {
    const email = "phase3-public@f3nation.test";
    const auth = createTestAuth(9001);
    const sessionToken = await signInAndGetToken(auth, email);
    const authHeaders = { authorization: `Bearer ${sessionToken}` };

    const client = await auth.api.createOAuthClient({
      headers: authHeaders,
      body: {
        redirect_uris: [PUBLIC_REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        token_endpoint_auth_method: "none",
        scope: "openid profile email offline_access",
      },
    });
    expect(client.client_id).toBeTruthy();

    const tokenBody = await authorizeAndExchange(auth, {
      sessionToken,
      clientId: client.client_id,
      // Deliberately no clientSecret — a public client authenticates with
      // PKCE alone, matching apps/auth/src/lib/oauth.ts's isPublic branch.
      redirectUri: PUBLIC_REDIRECT_URI,
      scope: "openid profile email offline_access",
    });

    const payload = decodeJwt(tokenBody.access_token);
    expect(isAccessTokenPayload(payload)).toBe(true);
    expect(payload.token_use).toBe("access");
    expect(payload.sub).toBe("9001");
    expect(payload.email).toBe(email);
    expect(tokenBody.id_token).toBeTruthy();
  });

  it("refuses to create a Better Auth user for an email with no real F3 users row", async () => {
    // The core security invariant this design is built around (see
    // findF3UserId's doc comment): a bare MFA code should never be able to
    // conjure a new identity on its own. Unlike the two tests above,
    // findF3UserId resolves null here — no real users row for this email.
    const email = "phase3-unregistered@f3nation.test";
    const auth = createTestAuth(null);

    const otp = await auth.api.createVerificationOTP({
      body: { email, type: "sign-in" },
    });
    // A specific, catchable error — not just "throws something". Before
    // the create.before hook was hardened to throw explicitly, returning
    // `false` here made Better Auth's own signInEmailOTP handler
    // dereference `.id` on a null user, an unrelated TypeError that
    // happened to also satisfy a bare `.rejects.toThrow()`. Asserting the
    // actual error code pins the real fix, not just "some error happened".
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp } }),
    ).rejects.toMatchObject({ body: { code: "NO_F3_ACCOUNT" } });
  });

  it("registration hand-off: sign-in is refused before the F3 users row exists and succeeds once it does", async () => {
    // Exercises the engine-level guarantee the hand-off relies on: while
    // findF3UserId resolves null, sign-in is refused; once it resolves (as
    // it would once /api/register has created the `users` row), the same
    // email can complete sign-in. Uses a new code for the second attempt
    // because the refused attempt already consumed the first one.
    const email = "phase3-handoff@f3nation.test";
    let f3UserId: number | null = null;
    const memoryDb: MemoryDB = {};
    const options = {
      baseURL: BASE_URL,
      basePath: BASE_PATH,
      secret: "test-only-not-a-real-secret",
      issuer: ISSUER,
      database: memoryAdapter(memoryDb),
      sendVerificationOTP: () => Promise.resolve(),
      findF3UserId: () => Promise.resolve(f3UserId),
    };
    const authOptions = buildBetterAuthOptions(options);
    for (const table of Object.keys(getAuthTables(authOptions))) {
      memoryDb[table] ??= [];
    }
    const auth = createAuthInstance(options);

    const preRegistrationOtp = await auth.api.createVerificationOTP({
      body: { email, type: "sign-in" },
    });
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: preRegistrationOtp } }),
    ).rejects.toMatchObject({ body: { code: "NO_F3_ACCOUNT" } });

    // Registration completes — mirrors /api/register creating the users row.
    f3UserId = 6161;

    const postRegistrationOtp = await auth.api.createVerificationOTP({
      body: { email, type: "sign-in" },
    });
    const signIn = await auth.api.signInEmailOTP({
      body: { email, otp: postRegistrationOtp },
    });
    expect(signIn.token).toBeTruthy();
  });

  it("registration hand-off: the code minted before registration is redeemed after it, matching the real UI flow", async () => {
    // The real flow (apps/auth/src/app/login/email/verify/verify-email-form
    // and apps/auth/src/app/register/register-form) never spends the
    // original code on a refused signIn.emailOtp call — it checks
    // /api/check-user first and only ever calls signIn.emailOtp once, after
    // /api/register has created the `users` row, using the same code that
    // was minted before registration. The test above proves the engine
    // refuses/allows correctly but mints a fresh code for the allowed
    // attempt; this one proves a code minted while findF3UserId still
    // resolves null is still redeemable once it resolves, with no refused
    // attempt burning it first.
    const email = "phase3-handoff-same-code@f3nation.test";
    let f3UserId: number | null = null;
    const memoryDb: MemoryDB = {};
    const options = {
      baseURL: BASE_URL,
      basePath: BASE_PATH,
      secret: "test-only-not-a-real-secret",
      issuer: ISSUER,
      database: memoryAdapter(memoryDb),
      sendVerificationOTP: () => Promise.resolve(),
      findF3UserId: () => Promise.resolve(f3UserId),
    };
    const authOptions = buildBetterAuthOptions(options);
    for (const table of Object.keys(getAuthTables(authOptions))) {
      memoryDb[table] ??= [];
    }
    const auth = createAuthInstance(options);

    const otp = await auth.api.createVerificationOTP({
      body: { email, type: "sign-in" },
    });

    // Registration completes — mirrors /api/register creating the users row.
    f3UserId = 6161;

    const signIn = await auth.api.signInEmailOTP({ body: { email, otp } });
    expect(signIn.token).toBeTruthy();
    expect(signIn.user.id).toBe("6161");
  });
});
