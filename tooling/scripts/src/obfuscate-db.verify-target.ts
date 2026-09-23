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
 *      the shared email sink (sink+<tag>@) (json columns are walked structurally; the
 *      serialized form false-positives on escape-adjacent Slack handles).
 *   2. Secret/session/token tables are empty — both the repo's own NextAuth
 *      adapter's plural names and the legacy singular ones (2026-07-10
 *      schema-drift catch).
 *   3. users.email / auth.user (email, email-as-id, image) fully obfuscated.
 *   4. Deterministic cross-table mapping still joins.
 *   5. auth.oauth_client(s) secrets invalidated.
 *   6. No kept OAuth client URI points at a production F3 host.
 *   7. attendance FK integrity.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… pnpm -F @acme/scripts obfuscate-db:verify-target \
 *     [--email-sink=<group@domain>]
 *
 * Databases whose name contains "prod" are refused: pointing this at an
 * un-obfuscated database would print raw PII into the console.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

// Must match the --email-sink the obfuscator ran with (same default).
const EMAIL_SINK = (
  process.argv
    .slice(2)
    .find((a) => a.startsWith("--email-sink="))
    ?.slice("--email-sink=".length) ?? "dev.staging-email-sink@f3nation.com"
).toLowerCase();
const [SINK_LOCAL, SINK_DOMAIN] = EMAIL_SINK.split("@") as [string, string];

function isSinkAddress(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.startsWith(`${SINK_LOCAL}+`) && lower.endsWith(`@${SINK_DOMAIN}`)
  );
}
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Retina-image filenames (logo@2x.png) are email-shaped; not PII.
const IMAGE_DENSITY_SUFFIX = /@\dx\.(?:png|jpe?g|gif|webp|svg)$/i;
// Matches only when the last domain label is 2+ letters, i.e. a real TLD.
const NON_EMAIL_TLD_GUARD = /\.[A-Za-z]{2,}$/;

// Slack mention syntax, both documented forms, including enterprise-grid `W`
// ids. Keep in sync with SLACK_MENTION_REGEX in obfuscate-db.ts.
const SLACK_MENTION_REGEX = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
// A mention the obfuscator rewrote looks like `<@U` + uppercase hex from
// fakeSlackId. A real Slack id almost always carries a letter outside A-F
// (U024BE7LH) or the enterprise `W` prefix, so anything not matching this
// shape is a mention that survived un-rewritten.
const OBFUSCATED_SLACK_ID = /^U[0-9A-F]{8,}$/;

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
  "auth.better_auth_oauth_access_token",
  "auth.better_auth_oauth_refresh_token",
  "auth.better_auth_oauth_consent",
  "auth.better_auth_oauth_client_assertion",
  "auth.better_auth_session",
  "auth.better_auth_account",
  "auth.better_auth_verification",
  "auth.better_auth_jwks",
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
  const mentionViolations: string[] = [];
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
          // Slack ids join straight to attendance.user_id, so one that
          // survived scrubbing re-links a faked user to their real identity.
          // Same rule as below: record the location, never the value.
          for (const m of text.matchAll(SLACK_MENTION_REGEX)) {
            if (OBFUSCATED_SLACK_ID.test(m[1]!)) continue;
            mentionViolations.push(
              `${col.table_schema}.${col.table_name}.${col.column_name}`,
            );
            break;
          }
          for (const match of text.match(EMAIL_REGEX) ?? []) {
            if (IMAGE_DENSITY_SUFFIX.test(match)) continue;
            // Real TLDs are alphabetic. Double-encoded JSON leaves a literal
            // "\n" before an @handle ("\n@F.3."), which the regex reads as
            // local part "n" at domain "F.3" (real-data finding 2026-09-22).
            if (!NON_EMAIL_TLD_GUARD.test(match)) continue;
            if (isSinkAddress(match)) {
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
  const uniqueMentions = [...new Set(mentionViolations)];
  check(
    "Slack id sweep",
    uniqueMentions.length === 0,
    uniqueMentions.length === 0
      ? `0 un-rewritten Slack mentions across ${columns.length} text/json columns (public + auth)`
      : `${uniqueMentions.length} column(s) carry a real Slack id: ${uniqueMentions.slice(0, 5).join("; ")}`,
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

    // Every user's address is exactly sink+<their id>.
    const [usersBad] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users
      WHERE email IS NOT NULL
        AND lower(email) <> (${SINK_LOCAL} || '+' || id || '@' || ${SINK_DOMAIN})`;
    check(
      "users.email is sink+<id> for every user",
      usersBad?.n === 0,
      `${usersBad?.n} nonconforming`,
    );

    const [namesBad] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users
      WHERE (f3_name IS NOT NULL AND f3_name <> 'F3 ' || id)
         OR (first_name IS NOT NULL AND first_name <> 'First ' || id)
         OR (last_name IS NOT NULL AND last_name <> 'Last ' || id)`;
    check(
      "user names are F3/First/Last <id>",
      namesBad?.n === 0,
      `${namesBad?.n} nonconforming`,
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
        WHERE (email IS NOT NULL
            AND lower(email) NOT LIKE ${SINK_LOCAL} || '+%@' || ${SINK_DOMAIN})
           OR (id LIKE '%@%'
            AND lower(id) NOT LIKE ${SINK_LOCAL} || '+%@' || ${SINK_DOMAIN})
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

    // No kept OAuth client may still send a code, logout, or CORS grant to a
    // production F3 host (anything under f3nation.com not prefixed staging.).
    const clientTargets: string[] = [];
    if (await tableExists(sql, "auth.better_auth_oauth_client")) {
      const rows = await sql<{ u: string | null }[]>`
        SELECT unnest(redirect_uris || coalesce(post_logout_redirect_uris, '{}')
          || ARRAY[backchannel_logout_uri]) AS u
        FROM auth.better_auth_oauth_client`;
      for (const r of rows) if (r.u) clientTargets.push(r.u);
    }
    for (const table of ["auth.oauth_clients", "auth.oauth_client"]) {
      if (!(await tableExists(sql, table))) continue;
      const rows = await sql<
        { redirect_uris: string; allowed_origin: string }[]
      >`
        SELECT redirect_uris, allowed_origin FROM ${sql(table)}`;
      for (const r of rows) {
        clientTargets.push(r.allowed_origin);
        try {
          const parsed: unknown = JSON.parse(r.redirect_uris);
          if (Array.isArray(parsed)) {
            for (const u of parsed)
              if (typeof u === "string") clientTargets.push(u);
          }
        } catch {
          clientTargets.push(r.redirect_uris);
        }
      }
    }
    const prodTargets = clientTargets.filter((u) => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        const isF3 = host === "f3nation.com" || host.endsWith(".f3nation.com");
        return isF3 && !host.startsWith("staging.");
      } catch {
        return false;
      }
    });
    // Counts only, same rule as the email sweep: never echo values.
    const checkedCount = Number(clientTargets.length);
    const prodCount = Number(prodTargets.length);
    check(
      "no OAuth client URI points at production",
      prodCount === 0,
      prodCount === 0
        ? `${checkedCount} URIs checked`
        : `${prodCount} of ${checkedCount} URIs point at a production F3 host`,
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
