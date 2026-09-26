/**
 * Derive the database name from a Postgres connection URL using the standard
 * URL parser (not a hand-rolled regex), so trailing slashes, query strings, and
 * URL fragments are handled consistently. Returns `undefined` for anything that
 * doesn't parse or carries no database path — callers MUST treat `undefined` as
 * "unknown" and fail closed (never proceed against an unidentified database).
 */
export function databaseNameFromUrl(url: string): string | undefined {
  try {
    const { pathname } = new URL(url);
    const name = pathname.replace(/^\/+/, "").split("/")[0];
    // Empty/missing path segment (e.g. the URL had no path) → "unknown".
    if (!name) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

// Exact-match, not substring: prod is named "f3data" (docs/STAGING_REFRESH.md),
// which a bare /prod/i test does not catch, but staging ("f3data-nonprod")
// legitimately contains "f3data" as a substring and must stay allowed.
const FORBIDDEN_DB_NAMES = new Set(["f3data"]);

export function looksLikeProdDbName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    FORBIDDEN_DB_NAMES.has(normalizedName) ||
    // Token-aware, not bare substring: /prod/i alone matches "nonprod" inside
    // "f3data-nonprod" (staging's own db name), wrongly blocking the
    // documented staging refresh target.
    /(?:^|[-_])prod(?:uction)?(?:$|[-_])/.test(normalizedName)
  );
}
