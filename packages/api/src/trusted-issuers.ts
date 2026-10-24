/**
 * The token issuers packages/api accepts JWT access tokens from.
 *
 * AUTH_TRUSTED_ISSUERS lists them, comma-separated, with no issuer ranked
 * above another. During the auth3 cutover it holds both auth servers: admin
 * and me move to auth3 before apps/api does and forward its access tokens
 * here, so for a while both servers' tokens must verify.
 *
 * Left unset (or empty), the api trusts NEXT_PUBLIC_AUTH_URL alone, used
 * exactly as written, so a deployment that sets nothing new trusts the same
 * issuer string it always has. NEXT_PUBLIC_AUTH_URL stays a single URL
 * because admin, me and map read it from the shared env as their sign-in URL.
 *
 * Every issuer's keys are fetched from `<issuer>/.well-known/jwks.json`.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Parse AUTH_TRUSTED_ISSUERS: comma-separated origins such as
 * `https://staging.auth3.f3nation.com`. Entries are trimmed, empty entries
 * ignored, and duplicates collapsed. Each must be a bare origin (an issuer
 * is compared to a token's `iss` claim exactly, and these servers put their
 * bare origin there) using https, or http for localhost/127.0.0.1 only.
 *
 * A malformed entry throws instead of being dropped, so a typo fails the
 * deploy at startup (as an invalid variable in @acme/env does) rather than
 * quietly turning every token from that issuer into a 401.
 */
export function parseIssuerList(raw: string | undefined): string[] {
  if (!raw) return [];
  const issuers = new Set<string>();
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    issuers.add(parseIssuerOrigin(entry));
  }
  return [...issuers];
}

function parseIssuerOrigin(entry: string): string {
  const invalid = (why: string) =>
    new Error(`Invalid AUTH_TRUSTED_ISSUERS entry "${entry}": ${why}`);

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw invalid("not a URL");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw invalid("must use https (http is allowed only for localhost)");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw invalid("must be a bare origin such as https://auth.example.com");
  }
  return url.origin;
}

/**
 * The full trusted list: AUTH_TRUSTED_ISSUERS when it names any issuer,
 * otherwise the fallback (NEXT_PUBLIC_AUTH_URL) verbatim, otherwise none.
 */
export function trustedIssuers(
  listRaw: string | undefined,
  fallback: string | undefined,
): string[] {
  const issuers = parseIssuerList(listRaw);
  if (issuers.length > 0) return issuers;
  return fallback ? [fallback] : [];
}
