/**
 * Classify a `jwtVerify` failure against a remote key set (jose 6
 * `createRemoteJWKSet`). Returns a short reason when the signing keys could
 * not be fetched — the auth service is down, erroring, or serving something
 * that isn't a key set — and `undefined` for anything else.
 *
 * Only a fetch failure is worth reporting: it fails every JWT request, while
 * a bad token (expired, wrong signature, an API key tried as a JWT, or an
 * old or forged token whose key id isn't in the set) is caller-caused.
 *
 * What jose throws when the fetch fails:
 * - nothing answered (refused, DNS): undici's `TypeError("fetch failed")`,
 *   with the network error code on `.cause`
 * - timed out: `JWKSTimeout` (`ERR_JWKS_TIMEOUT`)
 * - a non-200 response or a non-JSON body: a plain `JOSEError`
 *   (`ERR_JOSE_GENERIC`), which jose throws only from the key-set fetch
 * - JSON that isn't a key set: `JWKSInvalid` (`ERR_JWKS_INVALID`)
 */
export function jwksFetchFailure(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const code = (err as { code?: unknown }).code;
  if (
    code === "ERR_JWKS_TIMEOUT" ||
    code === "ERR_JWKS_INVALID" ||
    code === "ERR_JOSE_GENERIC"
  ) {
    return code;
  }
  // Matched precisely so a programming error (a TypeError reading a
  // property of undefined) isn't mistaken for the auth service being down.
  if (err.name === "TypeError" && /fetch failed/i.test(err.message)) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    return typeof cause?.code === "string" ? cause.code : "fetch_failed";
  }
  return undefined;
}
