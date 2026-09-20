import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { getAuthTables } from "@better-auth/core/db";
import { isAccessTokenPayload } from "@f3nation/sso";

import {
  allowProductionClientAction,
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
    isNationAdmin: () => Promise.resolve(false),
    // Permissive — unlike production, these tests need to exercise client
    // creation directly. See "denies client creation..." below for
    // coverage of production's actual (stricter) policy.
    allowClientAction: () => Promise.resolve(true),
  };
  const authOptions = buildBetterAuthOptions(options);
  for (const table of Object.keys(getAuthTables(authOptions))) {
    memoryDb[table] ??= [];
  }
  return createAuthInstance(options);
}

// Unlike createTestAuth above, this maps distinct emails to distinct F3 user
// ids (and lets a caller mark some of them nation admins) — needed to model
// two separate people signing in against the same instance, which the
// clientReference tests below require.
function createMultiUserTestAuth(
  emailToF3UserId: Record<string, number>,
  adminF3UserIds: Set<number> = new Set<number>(),
) {
  const memoryDb: MemoryDB = {};
  const options = {
    baseURL: BASE_URL,
    basePath: BASE_PATH,
    secret: "test-only-not-a-real-secret",
    issuer: ISSUER,
    database: memoryAdapter(memoryDb),
    sendVerificationOTP: () => Promise.resolve(),
    findF3UserId: (email: string) =>
      Promise.resolve(emailToF3UserId[email] ?? null),
    isNationAdmin: (f3UserId: number) =>
      Promise.resolve(adminF3UserIds.has(f3UserId)),
    allowClientAction: () => Promise.resolve(true),
  };
  const authOptions = buildBetterAuthOptions(options);
  for (const table of Object.keys(getAuthTables(authOptions))) {
    memoryDb[table] ??= [];
  }
  return createAuthInstance(options);
}

async function createConfidentialClient(
  auth: ReturnType<typeof createTestAuth>,
  sessionToken: string,
) {
  return auth.api.createOAuthClient({
    headers: { authorization: `Bearer ${sessionToken}` },
    body: {
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      scope: "openid profile email offline_access",
    },
  });
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
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp } }),
    ).rejects.toThrow();
  });

  it("lets any nation admin rotate the secret of a client another nation admin created (#876 Phase 3 client-reference)", async () => {
    const auth = createMultiUserTestAuth(
      {
        "admin-a@f3nation.test": 501,
        "admin-b@f3nation.test": 502,
      },
      new Set([501, 502]),
    );

    const tokenA = await signInAndGetToken(auth, "admin-a@f3nation.test");
    const client = await createConfidentialClient(auth, tokenA);
    expect(client.client_secret).toBeTruthy();

    // A different nation admin, who did not create this client, rotates its
    // secret — only possible because clientReference stamped the client
    // with F3_NATION_CLIENT_REFERENCE_ID instead of admin A's own user id.
    const tokenB = await signInAndGetToken(auth, "admin-b@f3nation.test");
    const rotated = await auth.api.rotateClientSecret({
      headers: { authorization: `Bearer ${tokenB}` },
      body: { client_id: client.client_id },
    });
    expect(rotated.client_secret).toBeTruthy();
    expect(rotated.client_secret).not.toBe(client.client_secret);
  });

  it("still refuses to let one non-admin rotate another non-admin's client", async () => {
    const auth = createMultiUserTestAuth({
      "pax-a@f3nation.test": 601,
      "pax-b@f3nation.test": 602,
    });

    const tokenA = await signInAndGetToken(auth, "pax-a@f3nation.test");
    const client = await createConfidentialClient(auth, tokenA);

    const tokenB = await signInAndGetToken(auth, "pax-b@f3nation.test");
    await expect(
      auth.api.rotateClientSecret({
        headers: { authorization: `Bearer ${tokenB}` },
        body: { client_id: client.client_id },
      }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("denies client creation under production's allowClientAction policy, even for a nation admin (#1046 review finding)", async () => {
    // clientReference alone can't tell "one of the two F3-managed clients"
    // apart from any other client a nation admin happens to create — it
    // only ever sees the calling session, never the client being created.
    // Production closes that gap by denying "create" outright via
    // allowProductionClientAction instead; this wires the real function in,
    // not a re-declared copy of its policy.
    const memoryDb: MemoryDB = {};
    const options = {
      baseURL: BASE_URL,
      basePath: BASE_PATH,
      secret: "test-only-not-a-real-secret",
      issuer: ISSUER,
      database: memoryAdapter(memoryDb),
      sendVerificationOTP: () => Promise.resolve(),
      findF3UserId: () => Promise.resolve(701),
      isNationAdmin: () => Promise.resolve(true),
      allowClientAction: allowProductionClientAction,
    };
    const authOptions = buildBetterAuthOptions(options);
    for (const table of Object.keys(getAuthTables(authOptions))) {
      memoryDb[table] ??= [];
    }
    const auth = createAuthInstance(options);

    const token = await signInAndGetToken(auth, "admin-c@f3nation.test");
    await expect(createConfidentialClient(auth, token)).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
  });
});

describe("allowProductionClientAction", () => {
  it("denies create and configure-client-credentials-scopes, allows everything else", async () => {
    await expect(allowProductionClientAction("create")).resolves.toBe(false);
    await expect(
      allowProductionClientAction("configure-client-credentials-scopes"),
    ).resolves.toBe(false);

    for (const action of [
      "read",
      "update",
      "delete",
      "list",
      "rotate",
    ] as const) {
      await expect(allowProductionClientAction(action)).resolves.toBe(true);
    }
  });
});
