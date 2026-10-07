import postgres from "postgres";

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

/**
 * A Cloud SQL unix socket (Cloud Run's `--set-cloudsql-instances` mounts
 * them at /cloudsql/<project>:<region>:<instance>) given the libpq way, as a
 * `host=` query parameter: `postgresql://user:pass@localhost/db?host=/cloudsql/…`.
 * postgres.js would send `host` to the server as a startup parameter, so it
 * is split off here and handed over as the `host` option, whose leading `/`
 * makes postgres.js connect through the socket. TCP URLs pass through
 * unchanged.
 */
function splitSocketHost(url: string): {
  url: string;
  socketHost?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never echo the URL: it carries the password.
    throw new Error("Database URL does not parse");
  }
  const host = parsed.searchParams.get("host");
  if (!host?.startsWith("/")) return { url };
  parsed.searchParams.delete("host");
  return { url: parsed.toString(), socketHost: host };
}

/** postgres.js connection to a TCP or socket (`?host=/…`) URL. */
export function openPostgres(
  url: string,
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
): postgres.Sql {
  const { url: tcpUrl, socketHost } = splitSocketHost(url);
  return postgres(
    tcpUrl,
    socketHost ? { ...options, host: socketHost } : options,
  );
}

/**
 * libpq environment (PGHOST, PGPASSWORD, …) for pg_dump/pg_restore/psql, so
 * the password never appears in a child's argv.
 */
export function libpqEnv(url: string): Record<string, string> {
  const { url: tcpUrl, socketHost } = splitSocketHost(url);
  const parsed = new URL(tcpUrl);
  const database = databaseNameFromUrl(tcpUrl);
  if (!database) throw new Error("Database URL names no database");
  const env: Record<string, string> = {
    PGHOST: socketHost ?? parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
  };
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}
