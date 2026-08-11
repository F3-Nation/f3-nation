/**
 * Post-obfuscation assertion suite for a REAL database copy (F3-65, phase 2).
 *
 * The sibling harness (obfuscate-db.verify.ts) proves the obfuscator against
 * a synthetic seed it plants itself. This script instead verifies an EXISTING
 * database that obfuscate-db.ts has already run against — the supervised
 * real-data path. It is read-only.
 *
 * Checks:
 *   1. Email sweep — no email-shaped string anywhere in public+auth outside
 *      @obfuscated.f3nation.dev (json columns are walked structurally; the
 *      serialized form false-positives on escape-adjacent Slack handles).
 *   2. Secret/session/token tables are empty — both the repo's own NextAuth
 *      adapter's plural names and the legacy singular ones (2026-07-10
 *      schema-drift catch).
 *   3. users.email / auth.user (email, email-as-id, image) fully obfuscated.
 *   4. Deterministic cross-table mapping still joins.
 *   5. auth.oauth_client(s) secrets invalidated.
 *   6. attendance FK integrity.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… pnpm -F @acme/scripts obfuscate-db:verify-target
 *
 * Databases whose name contains "prod" are refused: pointing this at an
 * un-obfuscated database would print raw PII into the console.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

const OBFUSCATED_EMAIL_DOMAIN = "obfuscated.f3nation.dev";
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Retina-image filenames (logo@2x.png) are email-shaped; not PII.
const IMAGE_DENSITY_SUFFIX = /@\dx\.(?:png|jpe?g|gif|webp|svg)$/i;

const EMPTY_TABLES = [
  "public.auth_sessions",
  "public.auth_verification_tokens",
  "public.auth_accounts",
  "public.api_keys",
  "auth.oauth_authorization_codes",
  "auth.oauth_authorization_code",
  "auth.oauth_access_tokens",
  "auth.oauth_access_token",
  "auth.oauth_refresh_tokens",
  "auth.oauth_refresh_token",
  "auth.email_mfa_codes",
  "auth.email_mfa_code",
  "auth.sessions",
  "auth.session",
  "auth.verification_tokens",
  "auth.verificationToken",
];

type Sql = postgres.Sql;

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function quoteQualified(table: string): string {
  return table
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
}

/**
 * Whether a (schema-qualified) table exists. The EMPTY_TABLES list carries both
 * the repo's own NextAuth adapter's plural names and the legacy singular
 * ones; only one family exists in any given target, so absent members are
 * expected, not failures.
 */
async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT to_regclass(${quoteQualified(table)}) IS NOT NULL AS present`;
  return row?.present ?? false;
}

/** Collect every string in a JSON value: leaves and object keys. */
function stringLeaves(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const v of value) stringLeaves(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      stringLeaves(v, out);
    }
  }
  return out;
}

async function sweepForEmails(sql: Sql): Promise<void> {
  const columns = await sql<
    {
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
    }[]
  >`
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema IN ('public', 'auth')
      AND t.table_type = 'BASE TABLE'
      AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        OR c.udt_name = 'citext')`;

  const violations: string[] = [];
  const LIMIT = 40;
  for (const col of columns) {
    if (violations.length >= LIMIT) break;
    const qualified = quoteQualified(`${col.table_schema}.${col.table_name}`);
    const isJson = col.data_type === "json" || col.data_type === "jsonb";
    const cursor = sql
      .unsafe(
        `SELECT "${col.column_name}"::text AS v FROM ${qualified}
         WHERE "${col.column_name}"::text LIKE '%@%'`,
      )
      .cursor(5000);
    scan: for await (const rows of cursor) {
      for (const row of rows as unknown as { v: string }[]) {
        const texts = isJson ? stringLeaves(JSON.parse(row.v), []) : [row.v];
        for (const text of texts) {
          for (const match of text.match(EMAIL_REGEX) ?? []) {
            if (IMAGE_DENSITY_SUFFIX.test(match)) continue;
            if (match.toLowerCase().endsWith(`@${OBFUSCATED_EMAIL_DOMAIN}`)) {
              continue;
            }
            // Never print the matched value itself: this script exists to
            // detect leaked PII, and printing the leaked value would create a
            // new exposure (terminal scrollback, CI logs) — location only.
            violations.push(
              `${col.table_schema}.${col.table_name}.${col.column_name}`,
            );
            if (violations.length >= LIMIT) break scan;
          }
        }
      }
    }
  }
  check(
    "email sweep",
    violations.length === 0,
    violations.length === 0
      ? `0 non-obfuscated emails across ${columns.length} text/json columns (public + auth)`
      : `${violations.length}${violations.length >= LIMIT ? "+" : ""} leaked: ${violations.slice(0, 5).join("; ")}`,
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const dbName = databaseNameFromUrl(databaseUrl);
  // Fail closed: if the database name can't be derived we cannot prove the
  // target isn't production, and sweeping an un-obfuscated database would print
  // raw PII to the console.
  if (!dbName) {
    throw new Error(
      "Refusing to run: could not derive a database name from DATABASE_URL — " +
        "cannot verify the target is not production.",
    );
  }
  if (looksLikeProdDbName(dbName)) {
    throw new Error(
      `Refusing to run: database name "${dbName}" is (or looks like) production — ` +
        `sweeping an un-obfuscated database would print raw PII.`,
    );
  }

  const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
  try {
    // Re-check against the server-reported name, not just the URL-parsed
    // one: a misconfigured or aliased DATABASE_URL (e.g. a connection pooler
    // or DNS alias) could resolve to a different database than its string
    // suggests. Same defense-in-depth obfuscate-db.ts already applies.
    const [current] = await sql`SELECT current_database() AS db`;
    const serverDbName = (current as { db: string }).db;
    if (looksLikeProdDbName(serverDbName)) {
      throw new Error(
        `Refusing to run: connected database is "${serverDbName}", which is ` +
          `(or looks like) production — sweeping an un-obfuscated database ` +
          `would print raw PII.`,
      );
    }

    console.log(`=== obfuscation target verification: "${dbName}" ===`);

    await sweepForEmails(sql);

    for (const table of EMPTY_TABLES) {
      if (!(await tableExists(sql, table))) {
        check(`${table} empty`, true, "absent (not in this schema — skipped)");
        continue;
      }
      const [row] = await sql.unsafe(
        `SELECT count(*)::int AS n FROM ${quoteQualified(table)}`,
      );
      const n = (row as unknown as { n: number }).n;
      check(`${table} empty`, n === 0, `${n} rows`);
    }

    const [usersBad] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users
      WHERE email IS NOT NULL
        AND email !~ ('^user-[0-9a-f]{8,}@' || ${OBFUSCATED_EMAIL_DOMAIN} || '$')`;
    check(
      "users.email all obfuscated shape",
      usersBad?.n === 0,
      `${usersBad?.n} nonconforming`,
    );

    // Both naming generations are optional — only one family exists in any
    // given target (same contract as EMPTY_TABLES above) — so
    // each of these must be guarded rather than run unconditionally: against
    // a target with only the plural family, an unguarded query against the
    // singular auth."user"/auth.oauth_client tables throws and aborts every
    // remaining check instead of reporting them PASS/FAIL.
    if (await tableExists(sql, "auth.user")) {
      const [authUserBad] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM auth."user"
        WHERE (email IS NOT NULL AND email NOT LIKE '%@' || ${OBFUSCATED_EMAIL_DOMAIN})
           OR (id LIKE '%@%' AND id NOT LIKE '%@' || ${OBFUSCATED_EMAIL_DOMAIN})
           OR image IS NOT NULL`;
      check(
        "auth.user obfuscated (incl. email-as-id)",
        authUserBad?.n === 0,
        `${authUserBad?.n} rows with raw email/id/image`,
      );
    } else {
      check(
        "auth.user obfuscated (incl. email-as-id)",
        true,
        "absent (not in this schema — skipped)",
      );
    }

    const [joined] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM update_requests ur
      WHERE ur.submitted_by IS NOT NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.email = ur.submitted_by)`;
    const [submitted] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM update_requests
      WHERE submitted_by IS NOT NULL`;
    const submittedCount = submitted?.n ?? 0;
    const joinedCount = joined?.n ?? 0;
    // A bare `joinedCount > 0` would pass on one coincidental match while the
    // mapping is mostly broken. Require a majority to actually join —
    // some legitimate non-user submitters (e.g. external admins) are
    // expected, so this isn't 100%, but a mostly-broken mapping can't hide
    // behind a single lucky row anymore.
    const MIN_JOIN_RATIO = 0.5;
    check(
      "deterministic cross-table email mapping",
      submittedCount === 0 || joinedCount / submittedCount >= MIN_JOIN_RATIO,
      `${joinedCount}/${submittedCount} submitted_by values join users.email`,
    );

    // No '-local' exclusion here: --preserve-local-seed is a sandbox-only
    // flag never used for a real staging refresh (see STAGING_REFRESH.md),
    // and this script has no way to know whether the run it's verifying used
    // it — checking every client is the only way this stays a real check
    // rather than one with a blind spot an operator can't see.
    let checkedAny = false;
    let pluralSecretsLive = 0;
    if (await tableExists(sql, "auth.oauth_clients")) {
      checkedAny = true;
      const [pluralSecrets] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM auth.oauth_clients
        WHERE client_secret_hash IS NOT NULL
          AND client_secret_hash != encode(sha256(('revoked:' || id)::bytea), 'hex')`;
      pluralSecretsLive = pluralSecrets?.n ?? 0;
    }
    let singularSecretsLive = 0;
    if (await tableExists(sql, "auth.oauth_client")) {
      checkedAny = true;
      const [singularSecrets] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM auth.oauth_client
        WHERE client_secret IS NOT NULL AND client_secret NOT LIKE 'revoked-%'`;
      singularSecretsLive = singularSecrets?.n ?? 0;
    }
    check(
      "oauth client secrets invalidated",
      pluralSecretsLive === 0 && singularSecretsLive === 0,
      checkedAny
        ? `${pluralSecretsLive} plural / ${singularSecretsLive} singular live secrets`
        : "absent (neither oauth client table in this schema — skipped)",
    );

    const [orphans] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM attendance a
      LEFT JOIN event_instances ei ON ei.id = a.event_instance_id
      WHERE a.event_instance_id IS NOT NULL AND ei.id IS NULL`;
    check(
      "attendance FKs intact",
      orphans?.n === 0,
      `${orphans?.n} orphaned rows`,
    );

    const failed = results.filter((r) => !r.pass);
    console.log("");
    console.log(
      failed.length === 0
        ? `ALL ${results.length} CHECKS PASSED`
        : `${failed.length}/${results.length} CHECKS FAILED`,
    );
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
