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
