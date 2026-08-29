import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { JSONWebKeySet } from "jose";
import { isAccessTokenPayload } from "@f3nation/sso";

import { createSpikeAuthInstance, SPIKE_RESOURCE } from "./auth-instance";

const TEST_EMAIL = "phase1-spike@f3nation.test";
const REDIRECT_URI = "https://spike-client.example.com/callback";

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

// Drives a full authorization_code + PKCE grant against a real (in-memory)
// Better Auth OAuth provider instance -- sign in, register a client,
// authorize, consent, exchange the code -- then checks the resulting
// access token against the actual production claim-shape verifier. See
// README.md for why this lives in its own package rather than apps/auth.
describe("Better Auth OAuth provider — access token claim shape (#876 Phase 1)", () => {
  it("issues an access token whose claims satisfy @f3nation/sso's AccessTokenPayload", async () => {
    const auth = createSpikeAuthInstance();

    // createVerificationOTP mints the code directly rather than emailing it
    // -- this spike isn't exercising delivery, just the OAuth token issuance
    // path once a user is signed in.
    const otp = await auth.api.createVerificationOTP({
      body: { email: TEST_EMAIL, type: "sign-in" },
    });

    const signIn = await auth.api.signInEmailOTP({
      body: { email: TEST_EMAIL, otp },
    });
    expect(signIn.token).toBeTruthy();
    const authHeaders = { authorization: `Bearer ${signIn.token}` };

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

    // oauth2Authorize reads the raw Fetch Request off the endpoint context
    // (needed for RFC 9207 issuer / redirect-mode derivation) and throws
    // "request not found" if invoked via the auth.api.* convenience
    // wrapper, which doesn't construct one. Drive it through auth.handler()
    // with a real Request instead, same as a real HTTP call would arrive.
    const pkce = pkcePair();
    const authorizeUrl = new URL(
      "http://localhost:3999/api/auth/oauth2/authorize",
    );
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set(
      "scope",
      "openid profile email offline_access",
    );
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "spike-state");
    authorizeUrl.searchParams.set("resource", SPIKE_RESOURCE);

    const authorize = await auth.handler(
      new Request(authorizeUrl, { headers: authHeaders }),
    );
    const authorizeLocation = authorize.headers.get("location");
    expect(authorizeLocation).toBeTruthy();
    // The redirect target is the app's own consent page, carrying a
    // signed, short-lived "oauth_query" continuation string as its query
    // string -- resubmit that same string to /oauth2/consent to approve.
    const oauthQuery = authorizeLocation!.split("?")[1]!;

    // Same "request not found" reason as authorize above: oauth2Consent
    // internally re-invokes the authorize finalization logic once consent
    // is accepted, which needs a real Request too.
    const consent = await auth.handler(
      new Request("http://localhost:3999/api/auth/oauth2/consent", {
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
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.verifier,
      resource: SPIKE_RESOURCE,
    });
    const basicAuth = Buffer.from(
      `${client.client_id}:${client.client_secret}`,
    ).toString("base64");
    const tokenResponse = await auth.handler(
      new Request("http://localhost:3999/api/auth/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${basicAuth}`,
        },
        body: tokenParams.toString(),
      }),
    );
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
    };

    const accessToken = tokenBody.access_token;
    const header = decodeProtectedHeader(accessToken);

    // Real signature + issuer verification, not a bare decode -- the
    // production path (@f3nation/sso's verifyJwtWithJwks) does both before
    // ever reaching isAccessTokenPayload's structural check below, via
    // createRemoteJWKSet fetching over real HTTP. This spike's auth
    // instance isn't listening on a real socket, so it fetches the same
    // JWKS response through auth.handler() and verifies against a local
    // JWK set instead -- same cryptographic verification, no network hop.
    const jwksResponse = await auth.handler(
      new Request("http://localhost:3999/api/auth/jwks"),
    );
    const jwks = (await jwksResponse.json()) as JSONWebKeySet;
    const localJwks = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(accessToken, localJwks, {
      // Better Auth's oauth-provider stamps the issuer as baseURL + the
      // auth mount path (verified empirically), not bare baseURL.
      issuer: "http://localhost:3999/api/auth",
    });

    // The real production verifier -- @f3nation/sso/token-verification --
    // not a reimplementation. This is the actual parity question #876
    // Phase 1 asks: does a Better Auth-issued access token satisfy the
    // same isAccessTokenPayload gate apps/api runs on every bearer token?
    expect(isAccessTokenPayload(payload)).toBe(true);

    expect(payload.token_use).toBe("access");
    expect(typeof payload.sub).toBe("string");
    expect(payload.email).toBe(TEST_EMAIL);
    expect(payload.scope).toBe("openid profile email offline_access");
    expect(typeof payload.client_id).toBe("string");

    // RS256, matching signAccessToken/getJWKS (apps/auth/src/lib/jwt.ts) --
    // required for the shared JWKS-based verifier to resolve a key at all.
    expect(header.alg).toBe("RS256");
  });
});
