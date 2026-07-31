/**
 * PII obfuscation script for the staging-refresh pipeline (F3-65, phase 1).
 *
 * Rewrites a *copy* of the production database so it is safe to load into
 * staging (f3data-nonprod). PII is replaced with deterministic fakes (same
 * input always maps to the same fake, so relational consistency holds across
 * tables), secrets/sessions are truncated, and JSON/free-text columns are
 * scrubbed of email-shaped strings.
 *
 * !! This script has only been proven against the local sandbox seed. It must
 * !! never be pointed at real data without human review of the PII inventory
 * !! (docs/STAGING_REFRESH.md) and a supervised run.
 *
 * Usage:
 *   pnpm -F @acme/scripts obfuscate-db -- \
 *     --allow-db <database-name> \
 *     --i-understand-this-rewrites-data \
 *     [--dry-run] [--preserve-local-seed]
 *
 * Flags (belt and suspenders — both are required to write anything):
 *   --allow-db <name>                    The script refuses to run unless the
 *                                        database it is connected to (via
 *                                        DATABASE_URL) has exactly this name.
 *   --i-understand-this-rewrites-data    Explicit acknowledgement that the
 *                                        target database will be rewritten.
 *   --dry-run                            Report what would change, write nothing.
 *   --preserve-local-seed                Keep the committed local dev fixtures
 *                                        intact: users @f3local.dev, api_keys
 *                                        local-*, oauth clients *-local.
 *
 * Databases whose name contains "prod" are always refused.
 */
import { createHash } from "node:crypto";

import postgres from "postgres";

import { databaseNameFromUrl } from "./db-url";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

const ALLOW_DB = flagValue("--allow-db");
const ACKNOWLEDGED = argv.includes("--i-understand-this-rewrites-data");
const DRY_RUN = argv.includes("--dry-run");
const PRESERVE_LOCAL_SEED = argv.includes("--preserve-local-seed");

// ---------------------------------------------------------------------------
// Deterministic fakes (seeded hash — same input, same output, every run)
// ---------------------------------------------------------------------------

// Fixed salt keeps the mapping stable across runs so repeated refreshes are
// diff-friendly. Bump the version suffix to rotate the whole pseudonym space.
const SALT = "f3-nation-staging-refresh-v1";

const LOCAL_SEED_EMAIL_SUFFIX = "@f3local.dev";
const OBFUSCATED_EMAIL_DOMAIN = "obfuscated.f3nation.dev";

function hashHex(input: string, length: number): string {
  return createHash("sha256")
    .update(`${SALT}:${input}`)
    .digest("hex")
    .slice(0, length);
}

function hashDigits(input: string, length: number): string {
  const hex = createHash("sha256").update(`${SALT}:${input}`).digest("hex");
  return (BigInt(`0x${hex.slice(0, 24)}`) % 10n ** BigInt(length))
    .toString()
    .padStart(length, "0");
}

// Memoized email mapping. users.email is UNIQUE, so on the (unlikely) chance
// two distinct inputs collide at 8 hex chars, deterministically lengthen the
// hash for the later input until the fake is unique within this run.
const emailFakes = new Map<string, string>();
const emailFakesInUse = new Map<string, string>();

function fakeEmail(original: string): string {
  const key = original.trim().toLowerCase();
  const existing = emailFakes.get(key);
  if (existing) return existing;
  let length = 8;
  let fake = `user-${hashHex(key, length)}@${OBFUSCATED_EMAIL_DOMAIN}`;
  while (emailFakesInUse.has(fake) && emailFakesInUse.get(fake) !== key) {
    length += 4;
    fake = `user-${hashHex(key, length)}@${OBFUSCATED_EMAIL_DOMAIN}`;
  }
  emailFakes.set(key, fake);
  emailFakesInUse.set(fake, key);
  return fake;
}

function fakeName(original: string): string {
  return `F3 User ${hashHex(original.trim().toLowerCase(), 6)}`;
}

function fakePhone(original: string): string {
  return `555-01${hashDigits(original, 2)}-${hashDigits(original, 4)}`;
}

function fakeSlackId(original: string): string {
  return `U${hashHex(original, 8).toUpperCase()}`;
}

// Emails hiding in free text / JSON get the same deterministic fake as the
// dedicated email columns, so relational consistency holds there too.
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function isAllowlistedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (lower.endsWith(`@${OBFUSCATED_EMAIL_DOMAIN}`)) return true;
  if (PRESERVE_LOCAL_SEED && lower.endsWith(LOCAL_SEED_EMAIL_SUFFIX)) {
    return true;
  }
  return false;
}

function scrubText(value: string): string {
  return value.replace(EMAIL_REGEX, (match) =>
    isAllowlistedEmail(match) ? match : fakeEmail(match),
  );
}

/**
 * Scrub email-shaped strings anywhere inside a JSON value by walking the
 * parsed structure and scrubbing each string (keys included). Scrubbing the
 * serialized form is NOT safe: an email-shaped match can begin inside a
 * backslash escape — `"…\n@A.1."` serializes to `…\\n@A.1.`, EMAIL_REGEX
 * reads `n@A.1` as an email and consumes the `n`, and the replacement turns
 * the orphaned `\` into an invalid `\u…` escape (crashes JSON.parse). Found
 * on real backblast data 2026-07-10. Returns the input reference unchanged
 * when nothing matched so callers can cheaply detect no-ops.
 */
function scrubJson(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const scrubbed = scrubJson(v);
      if (scrubbed !== v) changed = true;
      return scrubbed;
    });
    return changed ? next : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const entries = Object.entries(value).map(([k, v]) => {
      const key = scrubText(k);
      const scrubbed = scrubJson(v);
      if (key !== k || scrubbed !== v) changed = true;
      return [key, scrubbed] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Sql = postgres.Sql;

interface SummaryLine {
  table: string;
  column: string;
  action: string;
  rows: number;
}

const summary: SummaryLine[] = [];

function addSummary(
  table: string,
  column: string,
  action: string,
  rows: number,
) {
  summary.push({ table, column, action, rows });
}

/**
 * Row-based transform: stream a table in pk-keyset batches, apply `transform`
 * (returns the changed columns, or null when nothing changes), write updates,
 * and record per-column change counts.
 */
async function transformTable(
  sql: Sql,
  opts: {
    table: string;
    pk: string;
    columns: string[];
    /** Per-column label for the summary table, e.g. { email: "obfuscate" } */
    actions: Record<string, string>;
    /** Optional SQL prefilter to avoid streaming rows that can't change. */
    where?: postgres.Fragment;
    transform: (row: Row) => Row | null;
  },
): Promise<void> {
  const { table, pk, columns, actions, transform } = opts;
  const where = opts.where ?? sql`true`;
  const counts: Record<string, number> = {};
  const BATCH = 1000;
  let cursor: string | number | null = null;

  for (;;) {
    const cond =
      cursor === null
        ? sql`(${where})`
        : sql`(${where}) AND ${sql(pk)} > ${cursor}`;
    const rows: Row[] = await sql`
      SELECT ${sql([pk, ...columns])} FROM ${sql(table)}
      WHERE ${cond}
      ORDER BY ${sql(pk)} ASC
      LIMIT ${BATCH}`;
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.[pk] as string | number;

    for (const row of rows) {
      const changes = transform(row);
      if (!changes || Object.keys(changes).length === 0) continue;
      for (const col of Object.keys(changes)) {
        counts[col] = (counts[col] ?? 0) + 1;
      }
      if (!DRY_RUN) {
        await sql`
          UPDATE ${sql(table)} SET ${sql(changes)}
          WHERE ${sql(pk)} = ${row[pk] as string | number}`;
      }
    }
    if (rows.length < BATCH) break;
  }

  for (const [col, action] of Object.entries(actions)) {
    addSummary(table, col, action, counts[col] ?? 0);
  }
}

/** Set-based single statement (NULL-outs, regenerations, overwrites). */
async function runSetBased(
  sql: Sql,
  opts: {
    table: string;
    column: string;
    action: string;
    countWhere: postgres.Fragment;
    update: postgres.PendingQuery<postgres.Row[]>;
  },
): Promise<void> {
  // The secret/session/token lists carry both plural (repo schema) and
  // singular (better-auth) table names; only one family exists in any given
  // target, so an absent member must be skipped rather than crash the run
  // with an undefined-table error — same contract as truncateTable().
  if (!(await tableExists(sql, opts.table))) {
    addSummary(opts.table, opts.column, `${opts.action} (absent — skipped)`, 0);
    return;
  }
  if (DRY_RUN) {
    const [row] = await sql`
      SELECT count(*)::int AS n FROM ${sql(opts.table)} WHERE ${opts.countWhere}`;
    addSummary(opts.table, opts.column, opts.action, (row as Row).n as number);
  } else {
    const result = await opts.update;
    addSummary(opts.table, opts.column, opts.action, result.count);
  }
}

/**
 * Whether a (schema-qualified) table exists. The secret/session/token lists
 * carry both the repo schema's plural names and better-auth's singular ones;
 * only one family exists in any given target, so absent members must be skipped
 * rather than crash the run with an undefined-table error.
 */
async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const quoted = table
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
  const [row] = await sql<{ present: boolean }[]>`
    SELECT to_regclass(${quoted}) IS NOT NULL AS present`;
  return row?.present ?? false;
}

async function truncateTable(sql: Sql, table: string): Promise<void> {
  if (!(await tableExists(sql, table))) {
    addSummary(table, "*", "truncate (absent — skipped)", 0);
    return;
  }
  const [row] = await sql`SELECT count(*)::int AS n FROM ${sql(table)}`;
  const n = (row as Row).n as number;
  if (!DRY_RUN) {
    await sql`TRUNCATE TABLE ${sql(table)}`;
  }
  addSummary(table, "*", "truncate", n);
}

/** Truncate a set of tables in one statement — required when they hold
 * foreign keys to each other (single-table order would fail). Absent tables are
 * dropped from the set so a missing better-auth family doesn't abort the run. */
async function truncateTables(sql: Sql, tables: string[]): Promise<void> {
  const present: string[] = [];
  for (const table of tables) {
    if (!(await tableExists(sql, table))) {
      addSummary(table, "*", "truncate (absent — skipped)", 0);
      continue;
    }
    const [row] = await sql`SELECT count(*)::int AS n FROM ${sql(table)}`;
    addSummary(table, "*", "truncate", (row as Row).n as number);
    present.push(table);
  }
  if (!DRY_RUN && present.length > 0) {
    await sql.unsafe(
      `TRUNCATE TABLE ${present
        .map((t) =>
          t
            .split(".")
            .map((part) => `"${part}"`)
            .join("."),
        )
        .join(", ")}`,
    );
  }
}

// String/nullable helpers keeping the transform bodies terse.
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

// ---------------------------------------------------------------------------
// Per-table jobs (see docs/STAGING_REFRESH.md for the full PII inventory)
// ---------------------------------------------------------------------------

/**
 * Every base table in public+auth must be listed here (touched below) or in
 * KEPT_TABLES (reviewed as non-PII). Any table the script doesn't know is a
 * hard error BEFORE any writes: on 2026-07-10 the first real-data run found
 * prod carries singular-named better-auth tables (auth.user,
 * auth.oauth_access_token, …) alongside the plural ones the repo schema
 * defines — 4.9k raw emails and 37k tokens would have sailed through
 * silently. Schema drift must stop the run, not leak.
 */
const KEPT_TABLES = new Set([
  "public.achievements_x_users",
  "public.alembic_version",
  "public.attendance_x_attendance_types",
  "public.event_instances_x_event_types",
  "public.event_tags_x_event_instances",
  "public.event_tags_x_events",
  "public.events_x_event_types",
  "public.materializedviews",
  "public.orgs_x_slack_spaces",
  "public.permissions",
  "public.positions_x_orgs_x_users",
  "public.roles",
  "public.roles_x_api_keys_x_org",
  "public.roles_x_permissions",
  "public.roles_x_users_x_org",
  "auth.drizzle_migrations",
]);

const TOUCHED_TABLES = new Set([
  "public.attendance_types",
  "public.event_tags",
  "public.event_types",
  "public.users",
  "public.slack_users",
  "public.slack_spaces",
  "public.orgs",
  "public.locations",
  "public.events",
  "public.event_instances",
  "public.update_requests",
  "public.expansions",
  "public.expansions_x_users",
  "public.attendance",
  "public.positions",
  "public.achievements",
  "public.auth_sessions",
  "public.auth_verification_tokens",
  "public.auth_accounts",
  "public.api_keys",
  "auth.sessions",
  "auth.session",
  "auth.verification_tokens",
  "auth.verificationToken",
  "auth.oauth_authorization_codes",
  "auth.oauth_authorization_code",
  "auth.oauth_access_tokens",
  "auth.oauth_access_token",
  "auth.oauth_refresh_tokens",
  "auth.oauth_refresh_token",
  "auth.email_mfa_codes",
  "auth.email_mfa_code",
  "auth.oauth_clients",
  "auth.oauth_client",
  "auth.user",
  "auth.user_profiles",
]);

async function assertFullCoverage(sql: Sql): Promise<void> {
  const rows = await sql<{ qualified: string }[]>`
    SELECT table_schema || '.' || table_name AS qualified
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'auth') AND table_type = 'BASE TABLE'`;
  const unknown = rows
    .map((r) => r.qualified)
    .filter((t) => !KEPT_TABLES.has(t) && !TOUCHED_TABLES.has(t));
  if (unknown.length > 0) {
    throw new Error(
      `Refusing to run: ${unknown.length} table(s) this script has never ` +
        `classified: ${unknown.join(", ")}. Schema drift — review each for ` +
        `PII and add it to TOUCHED_TABLES (with handling below) or ` +
        `KEPT_TABLES before re-running.`,
    );
  }
}

async function obfuscate(sql: Sql): Promise<void> {
  const likeEmail = "%@%";

  await assertFullCoverage(sql);

  // ---- users ----------------------------------------------------------------
  await transformTable(sql, {
    table: "users",
    pk: "id",
    columns: [
      "f3_name",
      "first_name",
      "last_name",
      "email",
      "phone",
      "avatar_url",
      "emergency_contact",
      "emergency_phone",
      "emergency_notes",
      "meta",
    ],
    actions: {
      f3_name: "obfuscate (name)",
      first_name: "obfuscate (name)",
      last_name: "obfuscate (name)",
      email: "obfuscate (email)",
      phone: "obfuscate (phone)",
      avatar_url: "null out",
      emergency_contact: "null out",
      emergency_phone: "null out",
      emergency_notes: "null out",
      meta: "scrub emails (json)",
    },
    transform: (row) => {
      const email = str(row.email);
      if (
        PRESERVE_LOCAL_SEED &&
        email?.toLowerCase().endsWith(LOCAL_SEED_EMAIL_SUFFIX)
      ) {
        return null; // committed dev fixture — keep the whole row
      }
      const changes: Row = {};
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      for (const col of ["f3_name", "first_name", "last_name"]) {
        const v = str(row[col]);
        if (v) changes[col] = fakeName(`${col}:${v}`);
      }
      const phone = str(row.phone);
      if (phone) changes.phone = fakePhone(phone);
      for (const col of [
        "avatar_url",
        "emergency_contact",
        "emergency_phone",
        "emergency_notes",
      ]) {
        if (row[col] !== null) changes[col] = null;
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- slack_users ----------------------------------------------------------
  await transformTable(sql, {
    table: "slack_users",
    pk: "id",
    columns: [
      "slack_id",
      "user_name",
      "email",
      "avatar_url",
      "strava_access_token",
      "strava_refresh_token",
      "strava_expires_at",
      "strava_athlete_id",
      "meta",
    ],
    actions: {
      slack_id: "obfuscate (id)",
      user_name: "obfuscate (name)",
      email: "obfuscate (email)",
      avatar_url: "null out",
      strava_access_token: "null out (secret)",
      strava_refresh_token: "null out (secret)",
      strava_expires_at: "null out",
      strava_athlete_id: "null out",
      meta: "scrub emails (json)",
    },
    transform: (row) => {
      const email = str(row.email);
      if (
        PRESERVE_LOCAL_SEED &&
        email?.toLowerCase().endsWith(LOCAL_SEED_EMAIL_SUFFIX)
      ) {
        return null;
      }
      const changes: Row = {};
      const slackId = str(row.slack_id);
      if (slackId) changes.slack_id = fakeSlackId(slackId);
      const userName = str(row.user_name);
      if (userName) changes.user_name = fakeName(`slack:${userName}`);
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      for (const col of [
        "avatar_url",
        "strava_access_token",
        "strava_refresh_token",
        "strava_expires_at",
        "strava_athlete_id",
      ]) {
        if (row[col] !== null) changes[col] = null;
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- slack_spaces ----------------------------------------------------------
  await transformTable(sql, {
    table: "slack_spaces",
    pk: "id",
    columns: ["bot_token", "settings"],
    actions: {
      bot_token: "null out (secret)",
      settings: "scrub emails (json)",
    },
    transform: (row) => {
      const changes: Row = {};
      if (row.bot_token !== null) changes.bot_token = null;
      if (row.settings !== null) {
        const scrubbed = scrubJson(row.settings);
        if (scrubbed !== row.settings) {
          changes.settings = JSON.stringify(scrubbed);
        }
      }
      return changes;
    },
  });

  // ---- orgs -------------------------------------------------------------------
  await transformTable(sql, {
    table: "orgs",
    pk: "id",
    columns: ["email", "phone", "description", "website", "meta"],
    actions: {
      email: "obfuscate (email)",
      phone: "obfuscate (phone)",
      description: "scrub emails (text)",
      website: "scrub emails (text)",
      meta: "scrub emails (json)",
    },
    where: sql`email IS NOT NULL OR phone IS NOT NULL
      OR description LIKE ${likeEmail} OR website LIKE ${likeEmail}
      OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const email = str(row.email);
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      const phone = str(row.phone);
      if (phone) changes.phone = fakePhone(phone);
      // Real-data finding (2026-07-10): "website" fields carry typed-in email
      // addresses — treat every free-form URL field as scrub-worthy text.
      for (const col of ["description", "website"]) {
        const v = str(row[col]);
        if (v) {
          const scrubbed = scrubText(v);
          if (scrubbed !== v) changes[col] = scrubbed;
        }
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- locations ---------------------------------------------------------------
  await transformTable(sql, {
    table: "locations",
    pk: "id",
    columns: ["email", "description", "meta"],
    actions: {
      email: "obfuscate (email)",
      description: "scrub emails (text)",
      meta: "scrub emails (json)",
    },
    where: sql`email IS NOT NULL
      OR description LIKE ${likeEmail} OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const email = str(row.email);
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      const description = str(row.description);
      if (description) {
        const scrubbed = scrubText(description);
        if (scrubbed !== description) changes.description = scrubbed;
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- events --------------------------------------------------------------------
  await transformTable(sql, {
    table: "events",
    pk: "id",
    columns: ["email", "description", "meta"],
    actions: {
      email: "obfuscate (email)",
      description: "scrub emails (text)",
      meta: "scrub emails (json)",
    },
    where: sql`email IS NOT NULL
      OR description LIKE ${likeEmail} OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const email = str(row.email);
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      const description = str(row.description);
      if (description) {
        const scrubbed = scrubText(description);
        if (scrubbed !== description) changes.description = scrubbed;
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- event_instances -------------------------------------------------------------
  await transformTable(sql, {
    table: "event_instances",
    pk: "id",
    columns: [
      "email",
      "description",
      "preblast",
      "backblast",
      "preblast_rich",
      "backblast_rich",
      "meta",
    ],
    actions: {
      email: "obfuscate (email)",
      description: "scrub emails (text)",
      preblast: "scrub emails (text)",
      backblast: "scrub emails (text)",
      preblast_rich: "scrub emails (json)",
      backblast_rich: "scrub emails (json)",
      meta: "scrub emails (json)",
    },
    where: sql`email IS NOT NULL
      OR description LIKE ${likeEmail}
      OR preblast LIKE ${likeEmail}
      OR backblast LIKE ${likeEmail}
      OR preblast_rich::text LIKE ${likeEmail}
      OR backblast_rich::text LIKE ${likeEmail}
      OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const email = str(row.email);
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      for (const col of ["description", "preblast", "backblast"]) {
        const v = str(row[col]);
        if (v) {
          const scrubbed = scrubText(v);
          if (scrubbed !== v) changes[col] = scrubbed;
        }
      }
      for (const col of ["preblast_rich", "backblast_rich", "meta"]) {
        if (row[col] !== null) {
          const scrubbed = scrubJson(row[col]);
          if (scrubbed !== row[col]) changes[col] = JSON.stringify(scrubbed);
        }
      }
      return changes;
    },
  });

  // ---- update_requests ----------------------------------------------------------------
  await transformTable(sql, {
    table: "update_requests",
    pk: "id",
    columns: [
      "submitted_by",
      "reviewed_by",
      "event_contact_email",
      "location_contact_email",
      "event_description",
      "location_description",
      "ao_website",
      "event_meta",
      "meta",
    ],
    actions: {
      submitted_by: "obfuscate (email)",
      reviewed_by: "obfuscate (email)",
      event_contact_email: "obfuscate (email)",
      location_contact_email: "obfuscate (email)",
      event_description: "scrub emails (text)",
      location_description: "scrub emails (text)",
      ao_website: "scrub emails (text)",
      event_meta: "scrub emails (json)",
      meta: "scrub emails (json)",
    },
    transform: (row) => {
      const changes: Row = {};
      for (const col of [
        "submitted_by",
        "reviewed_by",
        "event_contact_email",
        "location_contact_email",
      ]) {
        const v = str(row[col]);
        if (!v || isAllowlistedEmail(v)) continue;
        // submitted_by/reviewed_by hold emails in practice; fall back to a
        // name-shaped fake if a value isn't email-shaped.
        changes[col] = v.includes("@") ? fakeEmail(v) : fakeName(v);
      }
      for (const col of [
        "event_description",
        "location_description",
        // Real-data finding (2026-07-10): users type email addresses into the
        // AO-website field.
        "ao_website",
      ]) {
        const v = str(row[col]);
        if (v) {
          const scrubbed = scrubText(v);
          if (scrubbed !== v) changes[col] = scrubbed;
        }
      }
      for (const col of ["event_meta", "meta"]) {
        if (row[col] !== null) {
          const scrubbed = scrubJson(row[col]);
          if (scrubbed !== row[col]) changes[col] = JSON.stringify(scrubbed);
        }
      }
      return changes;
    },
  });

  // update_requests.token is a capability token mailed to submitters —
  // regenerate so leaked staging data can't act on prod-issued links.
  await runSetBased(sql, {
    table: "update_requests",
    column: "token",
    action: "regenerate",
    countWhere: sql`true`,
    update: sql`UPDATE update_requests SET token = gen_random_uuid()`,
  });

  // ---- expansions (user-supplied coordinates are PII-adjacent — coarsen) ----
  await runSetBased(sql, {
    table: "expansions",
    column: "user_lat, user_lon",
    action: "coarsen (~11km)",
    countWhere: sql`round(user_lat::numeric, 1)::float8 IS DISTINCT FROM user_lat
      OR round(user_lon::numeric, 1)::float8 IS DISTINCT FROM user_lon`,
    update: sql`UPDATE expansions
      SET user_lat = round(user_lat::numeric, 1)::float8,
          user_lon = round(user_lon::numeric, 1)::float8
      WHERE round(user_lat::numeric, 1)::float8 IS DISTINCT FROM user_lat
        OR round(user_lon::numeric, 1)::float8 IS DISTINCT FROM user_lon`,
  });

  await runSetBased(sql, {
    table: "expansions_x_users",
    column: "notes",
    action: "null out (free text)",
    countWhere: sql`notes IS NOT NULL`,
    update: sql`UPDATE expansions_x_users SET notes = NULL WHERE notes IS NOT NULL`,
  });

  // ---- attendance / positions / achievements (free text & meta sweeps) ----
  await transformTable(sql, {
    table: "attendance",
    pk: "id",
    columns: ["meta"],
    actions: { meta: "scrub emails (json)" },
    where: sql`meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      if (row.meta === null) return null;
      const scrubbed = scrubJson(row.meta);
      if (scrubbed === row.meta) return null;
      return { meta: JSON.stringify(scrubbed) };
    },
  });

  await transformTable(sql, {
    table: "positions",
    pk: "id",
    columns: ["description"],
    actions: { description: "scrub emails (text)" },
    where: sql`description LIKE ${likeEmail}`,
    transform: (row) => {
      const v = str(row.description);
      if (!v) return null;
      const scrubbed = scrubText(v);
      return scrubbed === v ? null : { description: scrubbed };
    },
  });

  await transformTable(sql, {
    table: "achievements",
    pk: "id",
    columns: ["description", "meta"],
    actions: {
      description: "scrub emails (text)",
      meta: "scrub emails (json)",
    },
    where: sql`description LIKE ${likeEmail} OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const v = str(row.description);
      if (v) {
        const scrubbed = scrubText(v);
        if (scrubbed !== v) changes.description = scrubbed;
      }
      if (row.meta !== null) {
        const scrubbed = scrubJson(row.meta);
        if (scrubbed !== row.meta) changes.meta = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  // ---- lookup tables with free-text descriptions ----------------------------
  // Real-data finding (2026-07-10): regions define custom event types and put
  // contact emails in the descriptions. Same risk shape for tags/attendance
  // types, so all three get the text scrub.
  for (const table of ["event_types", "event_tags", "attendance_types"]) {
    await transformTable(sql, {
      table,
      pk: "id",
      columns: ["description"],
      actions: { description: "scrub emails (text)" },
      where: sql`description LIKE ${likeEmail}`,
      transform: (row) => {
        const v = str(row.description);
        if (!v) return null;
        const scrubbed = scrubText(v);
        return scrubbed === v ? null : { description: scrubbed };
      },
    });
  }

  // ---- auth.user (better-auth's own user table, singular) -------------------
  // Prod carries better-auth's singular-named tables alongside the repo
  // schema's plural ones; this one holds live emails and real names.
  await transformTable(sql, {
    table: "auth.user",
    pk: "id",
    columns: ["name", "f3_name", "hospital_name", "email", "image"],
    actions: {
      name: "obfuscate (name)",
      f3_name: "obfuscate (name)",
      hospital_name: "obfuscate (name)",
      email: "obfuscate (email)",
      image: "null out",
    },
    transform(row) {
      const changes: Row = {};
      for (const col of ["name", "f3_name", "hospital_name"]) {
        const v = row[col] as string | null;
        if (v) changes[col] = fakeName(v);
      }
      const email = row.email as string | null;
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      if (row.image !== null) changes.image = null;
      return changes;
    },
  });

  // ---- auth.user_profiles ----------------------------------------------------
  await transformTable(sql, {
    table: "auth.user_profiles",
    pk: "user_id",
    columns: ["hospital_name"],
    actions: { hospital_name: "obfuscate (name)" },
    transform(row) {
      const v = row.hospital_name as string | null;
      return v ? { hospital_name: fakeName(v) } : null;
    },
  });

  // ---- secrets: sessions, tokens, OAuth artifacts — truncate ----------------
  // Both naming generations: the plural tables from the repo schema and the
  // singular better-auth ones that exist on prod.
  for (const table of [
    "auth_sessions",
    "auth_verification_tokens",
    "auth_accounts",
    "auth.oauth_authorization_codes",
    "auth.oauth_access_tokens",
    "auth.oauth_refresh_tokens",
    "auth.email_mfa_codes",
    "auth.sessions",
    "auth.verification_tokens",
  ]) {
    await truncateTable(sql, table);
  }
  // The singular family has FKs among its members (oauth_refresh_token ->
  // oauth_access_token), so it truncates as one grouped statement.
  await truncateTables(sql, [
    "auth.oauth_authorization_code",
    "auth.oauth_access_token",
    "auth.oauth_refresh_token",
    "auth.email_mfa_code",
    "auth.session",
    "auth.verificationToken",
  ]);

  // ---- auth.user.id: better-auth keys users by EMAIL ADDRESS ----------------
  // The primary key itself is PII (real-data finding, 2026-07-10). Rewrite ids
  // through the same memoized fakeEmail as the email columns, so id === email
  // consistency and cross-table determinism hold. Snapshot ids first (a keyset
  // cursor over a mutating pk would skip/revisit rows), and run after the
  // token-table truncates so no FK rows reference the old ids.
  {
    const all = await sql<{ id: string }[]>`
      SELECT id FROM ${sql("auth.user")} ORDER BY id`;
    // fakeEmail dedups by case-NORMALIZED input, but auth.user carries
    // case-variant duplicates of the same email as distinct rows — those get
    // the same fake and collide on the pk. Track ids in use and lengthen the
    // (case-sensitive) hash until unique. ORDER BY id keeps it deterministic.
    const used = new Set(all.map((r) => r.id));
    let n = 0;
    for (const { id } of all) {
      if (!id.includes("@") || isAllowlistedEmail(id)) continue;
      let fake = fakeEmail(id);
      for (let length = 12; used.has(fake); length += 4) {
        fake = `user-${hashHex(id, length)}@${OBFUSCATED_EMAIL_DOMAIN}`;
      }
      n += 1;
      if (!DRY_RUN) {
        await sql`
          UPDATE ${sql("auth.user")} SET id = ${fake} WHERE id = ${id}`;
      }
      used.delete(id);
      used.add(fake);
    }
    addSummary("auth.user", "id", "obfuscate (email-as-id)", n);
  }

  // ---- api_keys: delete (cascades roles_x_api_keys_x_org) -------------------
  // With --preserve-local-seed the committed local-* dev keys survive.
  await runSetBased(sql, {
    table: "api_keys",
    column: "*",
    action: PRESERVE_LOCAL_SEED ? "delete (except local-*)" : "delete",
    countWhere: PRESERVE_LOCAL_SEED ? sql`key NOT LIKE 'local-%'` : sql`true`,
    update: PRESERVE_LOCAL_SEED
      ? sql`DELETE FROM api_keys WHERE key NOT LIKE 'local-%'`
      : sql`DELETE FROM api_keys`,
  });

  // ---- auth.oauth_clients: invalidate secrets --------------------------------
  // Overwrite the secret hash with one derived from a non-secret string, so no
  // plaintext secret can authenticate against staging. Local dev clients
  // (*-local, committed plaintext) survive only with --preserve-local-seed.
  await runSetBased(sql, {
    table: "auth.oauth_clients",
    column: "client_secret_hash",
    action: PRESERVE_LOCAL_SEED ? "invalidate (except *-local)" : "invalidate",
    countWhere: PRESERVE_LOCAL_SEED ? sql`id NOT LIKE '%-local'` : sql`true`,
    update: PRESERVE_LOCAL_SEED
      ? sql`UPDATE auth.oauth_clients
          SET client_secret_hash = encode(sha256(('revoked:' || id)::bytea), 'hex')
          WHERE id NOT LIKE '%-local'`
      : sql`UPDATE auth.oauth_clients
          SET client_secret_hash = encode(sha256(('revoked:' || id)::bytea), 'hex')`,
  });

  // ---- auth.oauth_client (singular, better-auth): plaintext secret ----------
  await runSetBased(sql, {
    table: "auth.oauth_client",
    column: "client_secret",
    action: "invalidate",
    countWhere: sql`true`,
    update: sql`UPDATE auth.oauth_client
        SET client_secret = 'revoked-' || encode(sha256(('revoked:' || id)::bytea), 'hex')`,
  });
}

// ---------------------------------------------------------------------------
// Safety rails + main
// ---------------------------------------------------------------------------

function getDatabaseNameFromUrl(url: string): string | undefined {
  return databaseNameFromUrl(url);
}

function printSummary(): void {
  const header = {
    table: "TABLE",
    column: "COLUMN",
    action: "ACTION",
    rows: "ROWS",
  };
  const rows = summary.map((s) => ({ ...s, rows: String(s.rows) }));
  const width = (key: "table" | "column" | "action" | "rows") =>
    Math.max(header[key].length, ...rows.map((r) => r[key].length));
  const line = (r: Record<"table" | "column" | "action" | "rows", string>) =>
    `${r.table.padEnd(width("table"))}  ${r.column.padEnd(width("column"))}  ${r.action.padEnd(width("action"))}  ${r.rows.padStart(width("rows"))}`;
  console.log("");
  console.log(line(header));
  console.log("-".repeat(line(header).length));
  for (const r of rows) console.log(line(r));
  console.log("");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!ALLOW_DB) {
    throw new Error(
      "Refusing to run: pass --allow-db <name> naming the exact database this script may rewrite.",
    );
  }
  if (!ACKNOWLEDGED) {
    throw new Error(
      "Refusing to run: pass --i-understand-this-rewrites-data to acknowledge this script rewrites the target database.",
    );
  }

  const urlDbName = getDatabaseNameFromUrl(databaseUrl);
  if (urlDbName !== ALLOW_DB) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at database "${urlDbName}" but --allow-db is "${ALLOW_DB}".`,
    );
  }
  if (/prod/i.test(ALLOW_DB)) {
    throw new Error(
      `Refusing to run: database name "${ALLOW_DB}" looks like production. Obfuscate a copy, never the source.`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [current] = await sql`SELECT current_database() AS db`;
    const serverDbName = (current as Row).db as string;
    if (serverDbName !== ALLOW_DB) {
      throw new Error(
        `Refusing to run: connected database is "${serverDbName}" but --allow-db is "${ALLOW_DB}".`,
      );
    }

    console.log(
      `${DRY_RUN ? "[DRY RUN] " : ""}Obfuscating PII in database "${serverDbName}"` +
        `${PRESERVE_LOCAL_SEED ? " (preserving local seed fixtures)" : ""}...`,
    );

    await obfuscate(sql);
    printSummary();

    const total = summary.reduce((sum, s) => sum + s.rows, 0);
    if (DRY_RUN) {
      console.log(
        `[DRY RUN] ${total} row-changes would be applied. No data was written.`,
      );
    } else {
      console.log(`Done. ${total} row-changes applied.`);
    }
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
