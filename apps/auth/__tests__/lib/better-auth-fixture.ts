// Shared memoryAdapter setup for the tests that drive a full OAuth flow
// through Better Auth (lib/better-auth.test.ts, the /api/oauth/* adapter
// tests). Not a test file itself.
import { createHash, randomBytes } from "node:crypto";

import { getAuthTables } from "@better-auth/core/db";
import { vi } from "vitest";

import {
  buildBetterAuthOptions,
  createAuthInstance,
  memoryAdapter,
} from "../../src/lib/better-auth";
import type { F3Profile, MemoryDB } from "../../src/lib/better-auth";

export const BASE_URL = "http://localhost:3999";
const BASE_PATH = "/api/auth2";
// Better Auth's endpoints live under BASE_PATH, but tokens carry the bare
// origin (BASE_URL) as iss, matching getAuth() and what relying parties expect.
export const ENDPOINT = `${BASE_URL}${BASE_PATH}`;
export const REDIRECT_URI = "https://phase3-client.example.com/callback";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function onboardedProfile(email: string): F3Profile {
  return {
    f3Name: "Tackle",
    avatarUrl: "https://cdn.example.com/tackle.png",
    email,
    emailVerified: true,
    onboardingCompleted: true,
  };
}

/** Every user is onboarded, with the profile above. */
export function findOnboardedProfile(): Promise<F3Profile> {
  return Promise.resolve(onboardedProfile("pax@f3nation.test"));
}

export type TestAuth = ReturnType<typeof createAuthInstance>;

/**
 * One instance whose `users` table is `profiles` (keyed by users.id), with
 * every email in `emails` mapped to its users.id. Tests mutate `profiles`
 * to model onboarding completing.
 */
export function createFlowAuth(emails: Record<string, number>) {
  const memoryDb: MemoryDB = {};
  const profiles = new Map<number, F3Profile>();
  const options = {
    baseURL: BASE_URL,
    basePath: BASE_PATH,
    secret: "test-only-not-a-real-secret",
    issuer: BASE_URL,
    database: memoryAdapter(memoryDb),
    sendVerificationOTP: () => Promise.resolve(),
    findF3UserId: (email: string) => Promise.resolve(emails[email] ?? null),
    isNationAdmin: () => Promise.resolve(false),
    allowClientAction: () => Promise.resolve(true),
    findF3Profile: vi.fn((f3UserId: number) =>
      Promise.resolve(profiles.get(f3UserId) ?? null),
    ),
  };
  const authOptions = buildBetterAuthOptions(options);
  for (const table of Object.keys(getAuthTables(authOptions))) {
    memoryDb[table] ??= [];
  }
  return { auth: createAuthInstance(options), memoryDb, profiles, options };
}

export async function signIn(auth: TestAuth, email: string) {
  const otp = await auth.api.createVerificationOTP({
    body: { email, type: "sign-in" },
  });
  const result = await auth.api.signInEmailOTP({ body: { email, otp } });
  return result.token;
}

/**
 * A client registered the way scripts/migrate-oauth-clients-to-better-auth.ts
 * registers a confidential one once it has a secret: skipConsent, offline_access,
 * client_secret_post, linked to the issuer resource.
 */
export async function createMigratedClient(
  auth: TestAuth,
  sessionToken: string,
) {
  const client = await auth.api.adminCreateOAuthClient({
    headers: { authorization: `Bearer ${sessionToken}` },
    body: {
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "client_secret_post",
      scope: "openid profile email offline_access",
      skip_consent: true,
    },
  });
  return { clientId: client.client_id, clientSecret: client.client_secret! };
}

/** An authorize URL shaped like packages/sso's: no resource, no nonce. */
export function authorizeParams(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state: "rp-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  });
}
