/**
 * The OAuth clients whose user access tokens packages/api accepts.
 *
 * A trusted issuer signs access tokens for every OAuth client registered with
 * it, including third-party apps. Those tokens are meant for the client that
 * asked for them, not for this API, so a token is accepted only when its
 * `client_id` claim names a first-party app that calls the API on the user's
 * behalf. Third-party apps call the API with an API key.
 *
 * AUTH_TRUSTED_CLIENT_IDS lists them, comma-separated. Unset, no JWT is
 * accepted. One list covers every trusted issuer, so each issuer must sign the
 * client's id as `client_id` and keep a client's id the same across issuers;
 * apps/api/characterization/auth/access-token-contract.ts pins the claim set.
 */

/**
 * Parse AUTH_TRUSTED_CLIENT_IDS. Entries are trimmed, empty entries ignored
 * and duplicates collapsed. An entry containing whitespace throws, so a
 * missing comma fails startup instead of quietly rejecting both clients.
 */
export function trustedClientIds(raw: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!raw) return ids;
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    if (/\s/.test(entry)) {
      throw new Error(
        `Invalid AUTH_TRUSTED_CLIENT_IDS entry "${entry}": client ids are comma-separated and contain no whitespace`,
      );
    }
    ids.add(entry);
  }
  return ids;
}
