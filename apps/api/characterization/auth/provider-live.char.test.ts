import { beforeAll, describe, expect, it } from "vitest";
import type { JWK } from "jose";
import {
  decodeJwt,
  decodeProtectedHeader,
  generateKeyPair,
  SignJWT,
} from "jose";

import {
  isAccessTokenPayload,
  verifyAccessToken,
  verifyJwtWithJwks,
} from "@f3nation/sso";

import type { AuthLiveTarget } from "../targets/auth-live";
import { authFetch, authTarget } from "../targets/auth-live";
import {
  ACCESS_TOKEN_ALG,
  CLIENT_ACCESS_TOKEN_CLAIMS,
  TOLERATED_EXTRA_CLAIMS,
  USER_ACCESS_TOKEN_CLAIMS,
} from "./access-token-contract";

/**
 * Live-mode coverage of the token PRODUCER: a deployed apps/auth (auth2
 * today, auth3 at the #876 Phase 3 cutover), checked against the contract
 * every relying party depends on. Skipped unless CHAR_TEST_AUTH_ISSUER is set
 * (see ../targets/auth-live.ts for every env var); the default hono run and
 * CI skip the whole file.
 *
 * Covered, headlessly:
 *   - discovery (`<issuer>/.well-known/openid-configuration`): issuer echo,
 *     the endpoints relying parties use, RS256 and S256 PKCE advertised;
 *   - the JWKS shape at discovery's jwks_uri (public RSA keys with a kid);
 *   - that packages/sso finds those keys where it looks for them: it never
 *     reads discovery, it fetches `<issuer>/.well-known/jwks.json`;
 *   - the token endpoint's error envelope for a missing and an unknown client;
 *   - packages/sso rejecting a token forged under a live kid and issuer;
 *   - with a client_credentials client configured: a real token, verified by
 *     packages/sso's verifier at the JWKS path it uses in production
 *     (`<issuer>/.well-known/jwks.json`, not discovery's jwks_uri) and checked
 *     against the frozen claim contract (access-token-contract.ts);
 *   - with a user token supplied: the same, plus the call apps/admin and
 *     apps/me make (`verifyAccessToken(token, issuer, clientId, true)`).
 *
 * Not covered, and why (the gap):
 *   - The authorization_code + email-OTP sign-in flow. It needs the emailed
 *     code, which only Mailpit exposes, and deployed environments send real
 *     mail. So a user token is never minted here: CHAR_TEST_AUTH_USER_TOKEN
 *     must come from a sign-in someone did (e.g. the access_token cookie an
 *     apps/me or apps/admin session holds). Locally the flow is drivable via
 *     apps/auth/AGENTS.md's Mailpit recipe.
 *   - client_credentials on the hand-rolled server (auth2's /api/oauth/*):
 *     it only implements authorization_code and refresh_token. The
 *     client-token cases skip themselves when discovery does not advertise
 *     the grant. On Better Auth, a client allowed the grant has to be
 *     provisioned in the database: production's clientPrivileges denies
 *     configure-client-credentials-scopes.
 *   - refresh_token rotation, PKCE enforcement, id_token claims, userinfo,
 *     revocation and logout: each needs a fresh authorization code.
 *   - Writes: no case creates users, clients or sessions on the target.
 *   - The claim contract with only CHAR_TEST_AUTH_ISSUER set: there is no
 *     real token to check without a client or a user token.
 *   - @f3nation/sso-next's re-export of verifyAccessToken, which apps/admin
 *     and apps/me import: it pulls in next/server, which apps/api doesn't
 *     have. The calls here use @f3nation/sso directly, so a future wrapper in
 *     sso-next would not be caught.
 */

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  grant_types_supported?: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported?: string[];
}

/** Per-request budget for a setup hook: authFetch's 15s timeout plus slack. */
const SETUP_TIMEOUT_MS = 20_000;

/** RFC 7517 private-key members; a published JWKS must carry none of them. */
const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/** packages/sso's DEFAULT_JWKS_PATH, resolved the way it resolves it. */
function ssoJwksUrl(issuer: string): string {
  return new URL("/.well-known/jwks.json", issuer).toString();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  expect(res.status, `GET ${url}`).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  return (await res.json()) as T;
}

/** Discovery and the JWKS it points at, shared by every case below. */
function useProvider(live: AuthLiveTarget) {
  const ctx = {} as { discovery: Discovery; jwks: { keys: JWK[] } };
  beforeAll(async () => {
    ctx.discovery = await getJson<Discovery>(
      `${live.issuer}/.well-known/openid-configuration`,
    );
    ctx.jwks = await getJson<{ keys: JWK[] }>(ctx.discovery.jwks_uri);
  }, SETUP_TIMEOUT_MS * 2);
  return ctx;
}

/**
 * The checks verifyAccessToken composes, with no jwksPath: packages/sso then
 * fetches `<issuer>/.well-known/jwks.json`, the production path, so this fails
 * wherever relying parties would.
 */
async function verifyLikeRelyingParties(token: string, issuer: string) {
  const result = await verifyJwtWithJwks(token, {
    authServerUrl: issuer,
    issuer,
  });
  if (!result.ok) {
    throw new Error(`packages/sso rejected the token: ${result.code}`);
  }
  return result.payload;
}

function expectSignedWithPublishedKey(token: string, jwks: { keys: JWK[] }) {
  const header = decodeProtectedHeader(token);
  expect(header.alg).toBe(ACCESS_TOKEN_ALG);
  expect(jwks.keys.map((k) => k.kid)).toContain(header.kid);
}

function expectContractClaims(
  claims: Record<string, unknown>,
  contract: readonly string[],
  issuer: string,
) {
  // Exactly the frozen claims, apart from the registered extras an engine may
  // add; any other claim is a contract change.
  const tolerated: readonly string[] = TOLERATED_EXTRA_CLAIMS;
  expect(
    Object.keys(claims)
      .filter((claim) => !tolerated.includes(claim))
      .sort(),
  ).toEqual([...contract].sort());
  expect(claims.token_use).toBe("access");
  expect(claims.iss).toBe(issuer);
  for (const claim of ["sub", "scope", "client_id"]) {
    expect(typeof claims[claim]).toBe("string");
  }
  for (const claim of ["iat", "exp"]) {
    expect(typeof claims[claim]).toBe("number");
  }
  expect(isAccessTokenPayload(claims)).toBe(true);
}

// Read at collection time, where authTarget may be undefined.
const clientCredentials = authTarget?.clientCredentials;
const userToken = authTarget?.userToken;

describe.runIf(authTarget)("apps/auth provider contract (live)", () => {
  // runIf guarantees it; the narrowing is for the type checker.
  const live = authTarget!;
  const provider = useProvider(live);

  describe("discovery", () => {
    it("echoes the configured issuer exactly (OIDC Discovery 4.3)", () => {
      expect(provider.discovery.issuer).toBe(live.issuer);
    });

    it("advertises the endpoints and algorithms relying parties use", () => {
      const d = provider.discovery;
      for (const endpoint of [
        d.authorization_endpoint,
        d.token_endpoint,
        d.jwks_uri,
      ]) {
        expect(() => new URL(endpoint)).not.toThrow();
      }
      expect(d.response_types_supported).toContain("code");
      expect(d.id_token_signing_alg_values_supported).toContain(
        ACCESS_TOKEN_ALG,
      );
      expect(d.code_challenge_methods_supported).toContain("S256");
      // Optional per RFC 8414, but both engines publish it, and the
      // client-token cases below key off it.
      expect(d.grant_types_supported).toEqual(
        expect.arrayContaining(["authorization_code", "refresh_token"]),
      );
    });
  });

  describe("JWKS", () => {
    it("publishes only public RSA signing keys, each with a kid", () => {
      const { keys } = provider.jwks;
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key.kty).toBe("RSA");
        for (const member of ["kid", "n", "e"] as const) {
          expect(typeof key[member]).toBe("string");
        }
        if (key.alg !== undefined) expect(key.alg).toBe(ACCESS_TOKEN_ALG);
        if (key.use !== undefined) expect(key.use).toBe("sig");
        for (const member of PRIVATE_JWK_MEMBERS) {
          expect(key).not.toHaveProperty(member);
        }
      }
    });

    // packages/sso (and so apps/admin and apps/me) and packages/api never
    // read discovery: they build `<issuer>/.well-known/jwks.json` themselves.
    // A server whose discovery points elsewhere still breaks every one of
    // them unless the conventional path serves the same keys. As of this
    // writing this fails against the Better Auth instance (issuer
    // <origin>/api/auth2): its keys are at /api/auth2/jwks, and
    // <origin>/.well-known/jwks.json serves the hand-rolled server's key.
    it("serves the same keys where packages/sso looks for them", async () => {
      const conventional = await getJson<{ keys: JWK[] }>(
        ssoJwksUrl(live.issuer),
      );
      // The key material too, not just the kid: a reused kid with a
      // different key would still break verification.
      const publicParts = (keys: JWK[]) =>
        keys
          .map(({ kid, n, e }) => ({ kid, n, e }))
          .sort((a, b) => (a.kid ?? "").localeCompare(b.kid ?? ""));
      expect(publicParts(conventional.keys)).toEqual(
        publicParts(provider.jwks.keys),
      );
    });
  });

  describe("token endpoint", () => {
    async function postToken(body: Record<string, string>) {
      return authFetch(provider.discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      });
    }

    it("rejects a request with no client as invalid_request", async () => {
      const res = await postToken({ grant_type: "client_credentials" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    });

    // Where client_credentials is advertised this is a real unknown-client
    // check. Otherwise only authorization_code is available, and with no real
    // code to send, the hand-rolled server answers invalid_grant before it
    // looks the client up; there the case only pins the error envelope.
    it("rejects an unknown client or bad grant with an RFC 6749 error", async () => {
      const grants = provider.discovery.grant_types_supported ?? [];
      const body: Record<string, string> = grants.includes("client_credentials")
        ? { grant_type: "client_credentials" }
        : {
            grant_type: "authorization_code",
            code: "characterization-not-a-code",
            redirect_uri: "https://characterization.invalid/callback",
          };
      const res = await postToken({
        ...body,
        client_id: "characterization-unknown-client",
        client_secret: "characterization-not-a-secret",
      });
      expect([400, 401]).toContain(res.status);
      const json = (await res.json()) as { error?: unknown };
      expect(["invalid_client", "invalid_grant"]).toContain(json.error);
    });
  });

  // Uses discovery's JWKS on purpose: this checks signature rejection, and the
  // JWKS location test above already covers the conventional path.
  it("is rejected by packages/sso when forged under a live kid", async () => {
    const { privateKey } = await generateKeyPair(ACCESS_TOKEN_ALG);
    const kid = provider.jwks.keys[0]?.kid;
    const forged = await new SignJWT({
      token_use: "access",
      email: "char-forged@example.com",
      scope: "openid",
      client_id: "characterization",
    })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALG, kid })
      .setSubject("1")
      .setIssuer(live.issuer)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const result = await verifyJwtWithJwks(forged, {
      authServerUrl: live.issuer,
      issuer: live.issuer,
      jwksPath: provider.discovery.jwks_uri,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  describe.runIf(clientCredentials)("client_credentials token", () => {
    const client = clientCredentials!;
    let token: string;

    beforeAll(async () => {
      const grants = provider.discovery.grant_types_supported ?? [];
      if (!grants.includes("client_credentials")) {
        throw new Error(
          "CHAR_TEST_AUTH_CLIENT_ID is set but discovery does not advertise client_credentials",
        );
      }
      const res = await authFetch(provider.discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: client.clientId,
          client_secret: client.clientSecret,
          // apps/auth registers its issuer as the one resource; without it
          // Better Auth issues an opaque token instead of a JWT.
          resource: live.issuer,
        }).toString(),
      });
      // beforeAll cannot expect(); throw so the cases below report it.
      if (res.status !== 200) {
        throw new Error(
          `client_credentials grant failed: ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as {
        access_token: string;
        token_type: string;
      };
      if (body.token_type.toLowerCase() !== "bearer") {
        throw new Error(`unexpected token_type: ${body.token_type}`);
      }
      token = body.access_token;
    }, SETUP_TIMEOUT_MS);

    it("is an RS256 JWT signed by a published key", () => {
      expect(token.split(".")).toHaveLength(3);
      expectSignedWithPublishedKey(token, provider.jwks);
    });

    it("verifies with packages/sso's verifier", async () => {
      const payload = await verifyLikeRelyingParties(token, live.issuer);
      expect(isAccessTokenPayload(payload)).toBe(true);
    });

    it("matches the frozen client-token claim contract", () => {
      const claims = decodeJwt(token);
      expectContractClaims(claims, CLIENT_ACCESS_TOKEN_CLAIMS, live.issuer);
      expect(claims.sub).toBe(client.clientId);
      expect(claims.client_id).toBe(client.clientId);
    });
  });

  describe.runIf(userToken)("user access token", () => {
    const user = userToken!;

    it("is an RS256 JWT signed by a published key", () => {
      expectSignedWithPublishedKey(user.token, provider.jwks);
    });

    it("verifies with packages/sso's verifier", async () => {
      const payload = await verifyLikeRelyingParties(user.token, live.issuer);
      expect(isAccessTokenPayload(payload)).toBe(true);
    });

    it("verifies the way apps/admin and apps/me call packages/sso", async () => {
      const result = await verifyAccessToken(
        user.token,
        live.issuer,
        user.clientId,
        true,
      );
      expect(result).toMatchObject({ ok: true });
    });

    it("matches the frozen user-token claim contract", () => {
      const claims = decodeJwt(user.token);
      expectContractClaims(claims, USER_ACCESS_TOKEN_CLAIMS, live.issuer);
      expect(claims.email).toEqual(expect.any(String));
      // sub is the real users.id, serialized as a numeric string (#876).
      expect(claims.sub).toMatch(/^\d+$/);
      expect(claims.client_id).toBe(user.clientId);
    });
  });
});
