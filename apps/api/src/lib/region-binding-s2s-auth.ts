/**
 * Service-to-service auth for the internal region-binding validator
 * (R5 Decision 11).
 *
 * TODO(F3R5_014-followup): replace the shared-secret bearer check below
 * with a real `@acme/sso` service-token verification. The SSO package does
 * not yet expose an s2s primitive (see packages/sso/src/index.ts — only
 * user-facing OAuth flows). Once it does, the validator should:
 *   1. Extract the bearer token from the Authorization header
 *   2. Call `authClient.verifyServiceToken(token)` with the expected
 *      audience (`f3-nation-api`) and scope (`region-binding:validate`)
 *   3. Reject on invalid signature, wrong audience, missing scope, or
 *      expired token
 *
 * Until that lands, we accept a shared secret configured via the
 * `REGION_BINDING_VALIDATOR_S2S_SECRET` env var. In development mode the
 * check is still enforced unless the env var is explicitly set to an empty
 * string, which is documented but not recommended.
 */

export interface VerifyS2sTokenInput {
  authorizationHeader: string | null;
  /** Inject the secret for tests; defaults to env. */
  expectedSecret?: string;
}

export type VerifyS2sTokenResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_header"
        | "malformed_header"
        | "wrong_token"
        | "server_misconfigured";
    };

export const verifyRegionBindingS2sToken = (
  input: VerifyS2sTokenInput,
): VerifyS2sTokenResult => {
  const expectedSecret =
    input.expectedSecret ?? process.env.REGION_BINDING_VALIDATOR_S2S_SECRET;
  if (!expectedSecret) {
    return { ok: false, reason: "server_misconfigured" };
  }

  const header = input.authorizationHeader;
  if (!header) return { ok: false, reason: "missing_header" };

  const lowered = header.toLowerCase();
  if (!lowered.startsWith("bearer ")) {
    return { ok: false, reason: "malformed_header" };
  }

  const token = header.slice(7).trim();
  if (!token) return { ok: false, reason: "malformed_header" };

  // Constant-time compare to avoid timing oracle on a small secret.
  if (!constantTimeEqual(token, expectedSecret)) {
    return { ok: false, reason: "wrong_token" };
  }

  return { ok: true };
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};
