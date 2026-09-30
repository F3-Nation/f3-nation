import { drizzle } from "drizzle-orm/postgres-js";
import pgConnectionString from "pg-connection-string";
import postgres from "postgres";

import { env } from "@acme/env";
import { isTest } from "@acme/shared/common/constants";

import { schema } from "..";
import { withQueryTimeout } from "./query-timeout";

// postgres-js has no bound on how long a query waits behind a saturated
// connection pool -- see withQueryTimeout's docstring.
//
// 60s is a hang backstop, NOT a latency budget. The production database
// already logs statements over 5s (log_min_duration_statement=5000), and
// those logs show the api and map users routinely running 5-31s statements
// (~180/week, mostly count() on list endpoints) -- a materially lower value
// here would convert real, succeeding queries into failures. PgBouncer's
// query_wait_timeout (default 120s) already bounds the wait for a *server*
// connection; this covers the postgres-js client-side queue, which
// PgBouncer cannot see.
//
// Overridable via QUERY_TIMEOUT_MS; 0 disables the wrapper entirely (set
// on the migrate/seed/reset scripts in package.json, where long-running
// statements are expected and a cancelled half-applied run is worse than a
// slow one). Read via process.env (like packages/shared's constants), not
// @acme/env: skipValidation short-circuits schema defaults in CI, which
// would silently disable the timeout exactly where the integration tests
// exercise it.
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
// Node coerces setTimeout delays above 2^31 - 1 ms (~24.8 days) to 1ms, so
// an oversized value would instantly time out every query — cap it.
const MAX_QUERY_TIMEOUT_MS = 2_147_483_647;

// Exported for tests. Blank/whitespace/invalid/oversized values fall through
// to the default: Number("") is 0, which would silently disable the wrapper
// on an empty deployment variable — disabling must be an explicit "0".
export const resolveQueryTimeoutMs = (raw: string | undefined): number => {
  const trimmed = raw?.trim();
  const parsed =
    trimmed === undefined || trimmed === "" ? Number.NaN : Number(trimmed);
  return Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= MAX_QUERY_TIMEOUT_MS
    ? parsed
    : DEFAULT_QUERY_TIMEOUT_MS;
};

const QUERY_TIMEOUT_MS = resolveQueryTimeoutMs(process.env.QUERY_TIMEOUT_MS);

/**
 * Split a Cloud SQL Unix-socket host out of a connection string.
 *
 * Cloud Run's built-in Cloud SQL connection exposes the database as a socket
 * under `/cloudsql/<project>:<region>:<instance>` (how `auth` and the Slack
 * bot connect). The libpq spelling of that is a `host=` query parameter
 * holding the socket directory, e.g.
 * `postgres://user:pass@/f3_prod?host=/cloudsql/f3data:us-central1:f3data`.
 * postgres.js can't take it as written: an empty host (`@/`) throws
 * `Invalid URL`, and with any other host the `host=` parameter is silently
 * ignored and it connects over TCP to that host instead. So a socket `host=`
 * is removed from the URL and returned separately, to be passed as the
 * options-form `host` (which postgres.js resolves to the socket path).
 *
 * Keeping the socket inside `DATABASE_URL` means switching a service between
 * the pooler and the socket stays a swap of that one secret. URLs without a
 * socket `host=` (every TCP URL today) are returned unchanged.
 */
export const splitSocketHost = (
  databaseUrl: string,
): { url: string; socketHost?: string } => {
  const queryStart = databaseUrl.indexOf("?");
  if (queryStart < 0) return { url: databaseUrl };
  const params = new URLSearchParams(databaseUrl.slice(queryStart + 1));
  const host = params.get("host");
  if (!host?.startsWith("/")) return { url: databaseUrl };
  params.delete("host");
  const query = params.toString();
  // postgres.js rejects an empty host; any placeholder works, since the
  // options-form host overrides it.
  const base = databaseUrl
    .slice(0, queryStart)
    .replace(/@\//, "@localhost/")
    .replace(/^(postgres(?:ql)?:)\/\/\//, "$1//localhost/");
  return { url: query ? `${base}?${query}` : base, socketHost: host };
};

/**
 * `postgres(url, options)` arguments for a connection string: the URL with
 * any socket `host=` split out, plus the options-form `host` that makes
 * postgres.js connect to `<dir>/.s.PGSQL.5432`. Every client built from
 * DATABASE_URL goes through this, so none can skip the socket handling.
 */
export const postgresArgs = (
  databaseUrl: string,
): { url: string; hostOptions: { host?: string } } => {
  const { url, socketHost } = splitSocketHost(databaseUrl);
  return { url, hostOptions: socketHost ? { host: socketHost } : {} };
};

/**
 * The database name migrate.ts suffixes its migrations table with
 * (`__drizzle_migrations_<name>`). Deliberately the legacy
 * `split("/").pop()` value — query string included — so every existing
 * environment keeps finding its migration history; renaming it would re-run
 * every migration. The only change is that a Cloud SQL socket `host=` is
 * removed first, so a socket URL names the same table as the TCP URL for
 * the same database with the same other parameters
 * (`…@/f3_prod?host=/cloudsql/…` → `f3_prod`,
 * `…?host=/cloudsql/…&sslmode=disable` → `f3_prod?sslmode=disable`).
 */
export const migrationsDatabaseName = (databaseUrl: string) =>
  splitSocketHost(databaseUrl).url.split("/").slice(-1)[0];

export const getDatabaseNameFromUri = (uri: string) => {
  const databaseNameRegex = /\/([^/?]+)(\?|$)/;
  const databaseNameMatch = databaseNameRegex.exec(uri);
  return databaseNameMatch ? databaseNameMatch[1] : undefined;
};

export const getDbUrl = () => {
  const databaseUrl = isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined");
  const databaseName = getDatabaseNameFromUri(databaseUrl);
  // Remove SSL to enable PGBouncer to work
  const useSsl = false; //  isProduction || (databaseName?.includes("_prod") ?? false);
  return { databaseUrl, useSsl, databaseName };
};

export const createDbClient = () => {
  const { databaseUrl, useSsl } = getDbUrl();
  const { url, hostOptions } = postgresArgs(databaseUrl);
  const sslOptions = useSsl ? { ssl: "require" as const } : undefined;
  const client = postgres(url, {
    ...sslOptions,
    // Cloud SQL Unix socket (see splitSocketHost); empty for TCP URLs.
    ...hostOptions,
    // Cloud Run scales to many instances, each holding its own pool (see
    // client.ts) — an untuned client defaults to `max: 10` per instance,
    // which exhausts the pooler's client ceiling under autoscaling.
    // connect_timeout tightens postgres-js's 30s default to 10s so a
    // saturated pooler surfaces as a fast failure instead of a slow one.
    // Sizing rationale: docs/AI_DEVELOPMENT_GUIDE.md ("Data layer").
    // max_lifetime is deliberately left on its postgres-js default — a
    // jittered 30–60min per connection; a fixed value would synchronize
    // expiry across every connection of a deploy into periodic reconnect
    // stampedes through the pooler.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // PgBouncer fronts the database in transaction pooling mode, which does
    // not support named prepared statements. Drizzle survives on the default
    // only because it issues queries through `client.unsafe()` (unprepared);
    // direct tagged-template usage (e.g. the seed/reset scripts) prepares by
    // default and would fail intermittently through the pooler.
    prepare: false,
  });
  if (QUERY_TIMEOUT_MS > 0) withQueryTimeout(client, QUERY_TIMEOUT_MS);
  return { db: drizzle(client, { schema }), close: () => client.end() };
};

export const getDb = () => createDbClient().db;

export async function createDatabaseIfNotExists(
  connectionString: string,
): Promise<void> {
  const config = pgConnectionString.parse(connectionString);
  const dbName = config.database;
  if (!dbName) {
    throw new Error("Database name not found in connection string");
  }

  // Remove the database name from the connection string
  const newConnectionString = connectionString.replace(
    `/${dbName}`,
    "/postgres",
  );
  const useSsl = false; // dbName?.includes("_prod") ?? false;

  // Connect to the default 'postgres' database (over the socket, if the
  // URL names one — see postgresArgs)
  const { url, hostOptions } = postgresArgs(newConnectionString);
  const sql = postgres(url, {
    ssl: useSsl,
    ...hostOptions,
  });

  try {
    // Check if the database exists
    const result = await sql`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;

    if (result.length === 0) {
      console.log(`Database ${dbName} does not exist. Creating it now...`);
      // Create the database
      await sql`CREATE DATABASE ${sql(dbName)}`;
      console.log(`Database ${dbName} created successfully.`);
    } else {
      console.log(`Database ${dbName} already exists.`);
    }
  } catch (error) {
    console.error("Error creating database:", error);
    throw error;
  } finally {
    await sql.end();
  }
}
