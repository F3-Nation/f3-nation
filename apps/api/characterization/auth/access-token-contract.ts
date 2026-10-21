/**
 * The frozen access-token contract, shared by the two sides that pin it:
 *
 * - `jwt.char.test.ts` pins the fixture that imitates apps/auth's
 *   signAccessToken (and apps/auth/__tests__/lib/jwt.test.ts pins the real
 *   producer to the same list).
 * - `provider-live.char.test.ts` pins a token a deployed apps/auth actually
 *   issued, so a cutover (auth2 -> auth3) cannot quietly change what every
 *   relying party reads.
 *
 * Changing a list here is a contract change for packages/sso, apps/api,
 * apps/admin and apps/me, not a test fix; call it out in the PR the same way
 * a golden-file diff is.
 */

/** Every claim a user access token carries (signAccessToken's exact set). */
export const USER_ACCESS_TOKEN_CLAIMS = [
  "client_id",
  "email",
  "exp",
  "iat",
  "iss",
  "scope",
  "sub",
  "token_use",
] as const;

/**
 * A client_credentials token has no user behind it, so it carries the user
 * contract minus `email`, and its `sub` is the client id.
 */
export const CLIENT_ACCESS_TOKEN_CLAIMS = USER_ACCESS_TOKEN_CLAIMS.filter(
  (claim) => claim !== "email",
);

/** The only signing algorithm packages/sso and packages/api accept. */
export const ACCESS_TOKEN_ALG = "RS256";
