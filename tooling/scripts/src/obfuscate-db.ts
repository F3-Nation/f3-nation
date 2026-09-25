/**
 * PII obfuscation script for the staging-refresh pipeline (F3-65, phase 1).
 *
 * Rewrites a *copy* of the production database so it is safe to load into
 * staging (f3data-nonprod). PII is replaced with deterministic fakes (same
 * input always maps to the same fake, so relational consistency holds across
 * tables), secrets/sessions are truncated, and JSON/free-text columns are
 * scrubbed of email-shaped strings. Prod's Slack tables (slack_spaces,
 * slack_users, orgs_x_slack_spaces) are emptied, not scrubbed: staging keeps
 * its own Slack data across a refresh (staging-slack.ts).
 *
 * !! This script has only been proven against the local sandbox seed. It must
 * !! never be pointed at real data without human review of the PII inventory
 * !! (docs/STAGING_REFRESH.md) and a supervised run.
 *
 * Usage:
 *   OBFUSCATION_SALT=<secret> DATABASE_URL=... pnpm -F @acme/scripts obfuscate-db -- \
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
 *   --email-sink <group@domain>          Shared group every email is rewritten
 *                                        onto (default
 *                                        dev.staging-email-sink@f3nation.com).
 *   --preserve-local-seed                Keep the committed local dev fixtures
 *                                        intact: users @f3local.dev, api_keys
 *                                        local-*, oauth clients *-local.
 *
 * OBFUSCATION_SALT (required env var) must be a long random secret stored
 * outside source control (prod secret manager) — never a compile-time
 * constant. The repo is public, so a committed salt lets anyone rebuild a
 * rainbow table over candidate emails/phones/names and reverse the "fake"
 * values back to real ones.
 *
 * The exact production database name ("f3data") and any name containing
 * "prod" are always refused.
 */
import { createHash } from "node:crypto";

import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

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

// The salt keeps the mapping stable across runs so repeated refreshes are
// diff-friendly, but it must never be a compile-time constant: this repo is
// public, and a committed salt lets anyone reproduce the forward hash over a
// candidate list and reverse a "fake" value back to the real input. Read from
// a required env var instead (rotate it to rotate the whole pseudonym space).
// Assigned in main() before any hashing happens.
let SALT: string;

const LOCAL_SEED_EMAIL_SUFFIX = "@f3local.dev";
// Every email ends up at one shared Google Group, plus-addressed per row, so
// staging can send real mail end to end without reaching a real person, and
// anyone in the group can sign in as any user (the code lands in the group).
// A user's address is keyed on users.id so it's easy to trace; see fakeEmail.
const DEFAULT_EMAIL_SINK = "dev.staging-email-sink@f3nation.com";
const EMAIL_SINK = (
  flagValue("--email-sink") ?? DEFAULT_EMAIL_SINK
).toLowerCase();
let SINK_LOCAL: string;
let SINK_DOMAIN: string;

function sinkAddress(tag: string): string {
  return `${SINK_LOCAL}+${tag}@${SINK_DOMAIN}`;
}

function isSinkAddress(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.startsWith(`${SINK_LOCAL}+`) && lower.endsWith(`@${SINK_DOMAIN}`)
  );
}

// sha256 hex digests are 64 chars — a collision-lengthening loop that keeps
// growing `length` past this stops changing its output and would spin
// forever on a true collision. Every such loop must check this.
const MAX_HASH_HEX_LENGTH = 64;

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

// Real email (lowercased) -> users.id, read from the target before any
// transform runs. An address that belongs to a user becomes that user's
// sink+<id> address everywhere it appears (update requests, free text), so cross-table relationships survive. On a target that was
// already obfuscated the lookup keys are the old fakes, which were applied
// consistently, so the same mapping holds.
const userIdByEmail = new Map<string, number>();

// Addresses with no user: a caller with a row passes a tag naming where it
// came from (org-12, event-34); free text gets ext-<hash>, memoized and
// lengthened on collision so one real address has one fake per run.
const emailFakes = new Map<string, string>();
const emailFakesInUse = new Map<string, string>();

function fakeEmail(original: string, tag?: string): string {
  const key = original.trim().toLowerCase();
  const userId = userIdByEmail.get(key);
  if (userId !== undefined) return sinkAddress(String(userId));
  if (tag) return sinkAddress(tag);
  const existing = emailFakes.get(key);
  if (existing) return existing;
  let length = 8;
  let fake = sinkAddress(`ext-${hashHex(key, length)}`);
  while (emailFakesInUse.has(fake) && emailFakesInUse.get(fake) !== key) {
    length += 4;
    if (length > MAX_HASH_HEX_LENGTH) {
      throw new Error(
        `fakeEmail: exhausted hash length disambiguating "${key}"`,
      );
    }
    fake = sinkAddress(`ext-${hashHex(key, length)}`);
  }
  emailFakes.set(key, fake);
  emailFakesInUse.set(fake, key);
  return fake;
}

function fakeName(original: string): string {
  return `F3 User ${hashHex(original.trim().toLowerCase(), 6)}`;
}

// "555" as the area code is the conventional non-working US fake-number
// marker; the exchange + subscriber number are independent hash digits (not
// two mod-reductions of the same value, which structurally collapsed to
// ~10,000 possible outputs and guaranteed mass collisions at F3's scale) —
// and 10 digits total, a valid-shaped NANP number instead of 11.
function fakePhone(original: string): string {
  const digits = hashDigits(original, 7);
  // NANP exchange codes can't start with 0 or 1 — force the first exchange
  // digit into 2-9 so the fake number stays valid-shaped.
  const exchangeFirst = String(2 + (Number(digits[0]) % 8));
  return `555-${exchangeFirst}${digits.slice(1, 3)}-${digits.slice(3)}`;
}

// Memoized like fakeEmail, and lengthened on collision the same way, so one
// real Slack id maps to one fake in every mention (a birthday-bound collision
// is expected around ~100k distinct ids at 8 hex chars).
const slackIdFakes = new Map<string, string>();
const slackIdFakesInUse = new Set<string>();

function fakeSlackId(original: string): string {
  const existing = slackIdFakes.get(original);
  if (existing) return existing;
  let length = 8;
  let fake = `U${hashHex(original, length).toUpperCase()}`;
  while (slackIdFakesInUse.has(fake)) {
    length += 4;
    if (length > MAX_HASH_HEX_LENGTH) {
      throw new Error(
        `fakeSlackId: exhausted hash length disambiguating "${original}"`,
      );
    }
    fake = `U${hashHex(original, length).toUpperCase()}`;
  }
  slackIdFakes.set(original, fake);
  slackIdFakesInUse.add(fake);
  return fake;
}

// Emails hiding in free text / JSON get the same deterministic fake as the
// dedicated email columns, so relational consistency holds there too.
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// Slack mention syntax (`<@U0REALSLACK>`) embedded in free text/Block Kit
// JSON (preblast/backblast bodies) — real-data finding 2026-08: this ID
// joins straight to prod's slack_users and so to a person, so it must not
// survive. Route through the memoized fakeSlackId so one member is the same
// fake in every mention. NOTE: this does
// NOT cover real names (pax_names/q_name) appearing in free text with no
// accompanying "@" — that's a separate, unresolved gap (see backblast_rich
// scrub call sites) that needs a name-substitution pass, not a regex.
//
// Both documented mention forms are matched: `<@U0REALSLACK>` and the
// pipe form `<@U0REALSLACK|display name>`, which Slack emits whenever the
// readable name is inlined. Enterprise-grid member ids use a `W` prefix.
// The display name after the pipe is itself real PII, so it is dropped
// rather than rewritten — the replacement always emits the bare form.
const SLACK_MENTION_REGEX = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

function isAllowlistedEmail(email: string): boolean {
  // Already a sink address: final. (Old @obfuscated.f3nation.dev fakes are
  // NOT allowlisted: an in-place run over an earlier refresh remaps them.)
  if (isSinkAddress(email)) return true;
  const lower = email.toLowerCase();
  if (PRESERVE_LOCAL_SEED && lower.endsWith(LOCAL_SEED_EMAIL_SUFFIX)) {
    return true;
  }
  return false;
}

function scrubText(value: string): string {
  const withoutMentions = value.replace(
    SLACK_MENTION_REGEX,
    (_match, id: string) => `<@${fakeSlackId(id)}>`,
  );
  return withoutMentions.replace(EMAIL_REGEX, (match) =>
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

// ---------------------------------------------------------------------------
// OAuth client URIs: prod -> staging
// ---------------------------------------------------------------------------
// Kept OAuth clients arrive with prod redirect / logout URIs, so a flow
// started in staging would hand its code (or POST its backchannel logout) to
// production. Known F3 app hosts map to their staging twins (hostnames from
// the deploy-*.yml staging_url values). Any other *.f3nation.com host that
// isn't already staging has no known twin and is dropped. Third-party hosts
// and localhost are left alone: they are not F3 production, and the
// invalidated client secret already stops a staging code being exchanged.
const F3_DOMAIN = "f3nation.com";
const STAGING_HOST_BY_PROD: Record<string, string> = {
  "auth.f3nation.com": "staging.auth2.f3nation.com",
  "auth2.f3nation.com": "staging.auth2.f3nation.com",
  "api.f3nation.com": "staging.api.f3nation.com",
  "admin.f3nation.com": "staging.admin.f3nation.com",
  "map.f3nation.com": "staging.map.f3nation.com",
  "me.f3nation.com": "staging.me.f3nation.com",
};

/** The staging form of `uri`, the uri unchanged, or null to drop it. */
function toStagingUri(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri; // custom scheme / not a URL: nothing host-shaped to rewrite
  }
  const host = url.hostname.toLowerCase();
  const staging = STAGING_HOST_BY_PROD[host];
  if (staging) {
    // Splice the host rather than url.toString(): that would append a "/" to
    // a bare origin, and allowed_origin is compared exactly.
    const at = uri.toLowerCase().indexOf(host, uri.indexOf("//") + 2);
    return uri.slice(0, at) + staging + uri.slice(at + host.length);
  }
  const isF3 = host === F3_DOMAIN || host.endsWith(`.${F3_DOMAIN}`);
  if (isF3 && !host.startsWith("staging.")) return null;
  return uri;
}

function toStagingUris(uris: string[]): string[] {
  return uris.flatMap((u) => {
    const mapped = toStagingUri(u);
    return mapped === null ? [] : [mapped];
  });
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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
  // Same contract as runSetBased/truncateTable: the secret/session/token
  // tables carry both a plural name (the repo's own NextAuth adapter schema)
  // and a singular one (legacy — pre-dates the current adapter, not written
  // to by any active code path, but still physically present on prod), and
  // only one family exists in any given target — an absent table must be
  // skipped, not crash the whole run (which would abort before later jobs,
  // e.g. the secrets truncation, ever ran).
  if (!(await tableExists(sql, table))) {
    for (const [col, action] of Object.entries(actions)) {
      addSummary(table, col, `${action} (table absent — skipped)`, 0);
    }
    return;
  }
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

    // Rows that change the same set of columns are written together, one
    // statement per group, instead of one round trip per row: a remote
    // target (staging through the Cloud SQL proxy) would otherwise spend
    // hours on latency alone.
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const changes = transform(row);
      if (!changes || Object.keys(changes).length === 0) continue;
      const cols = Object.keys(changes).sort();
      for (const col of cols) counts[col] = (counts[col] ?? 0) + 1;
      const key = cols.join(",");
      const group = groups.get(key) ?? [];
      group.push({ ...changes, [pk]: row[pk] });
      groups.set(key, group);
    }
    if (!DRY_RUN) {
      for (const [key, group] of groups) {
        await writeGroup(sql, table, pk, key.split(","), group);
      }
    }
    if (rows.length < BATCH) break;
  }

  for (const [col, action] of Object.entries(actions)) {
    addSummary(table, col, action, counts[col] ?? 0);
  }
}

const columnTypeCache = new Map<string, Map<string, string>>();

async function columnTypes(
  sql: Sql,
  table: string,
): Promise<Map<string, string>> {
  const cached = columnTypeCache.get(table);
  if (cached) return cached;
  const rows = await sql<{ name: string; type: string }[]>`
    SELECT attname AS name, format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = ${quoteQualified(table)}::regclass
      AND attnum > 0 AND NOT attisdropped`;
  const types = new Map(rows.map((r) => [r.name, r.type]));
  columnTypeCache.set(table, types);
  return types;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteQualified(table: string): string {
  return table.split(".").map(quoteIdent).join(".");
}

/**
 * One UPDATE for a group of rows changing the same columns, typed through
 * jsonb_to_recordset so arrays, citext and json columns convert exactly as
 * the per-row driver path did. json/jsonb changes arrive JSON.stringify'd
 * from the transforms; they are parsed back so they land as JSON, not as a
 * JSON string.
 */
async function writeGroup(
  sql: Sql,
  table: string,
  pk: string,
  cols: string[],
  group: Row[],
): Promise<void> {
  const types = await columnTypes(sql, table);
  const typeOf = (col: string): string => {
    const t = types.get(col);
    if (!t) throw new Error(`writeGroup: ${table}.${col} has no type`);
    return t;
  };
  const payload = group.map((r) => {
    const out: Row = { [pk]: r[pk] };
    for (const col of cols) {
      const v = r[col];
      const t = typeOf(col);
      out[col] =
        (t === "json" || t === "jsonb") && typeof v === "string"
          ? (JSON.parse(v) as unknown)
          : v;
    }
    return out;
  });
  const defs = [pk, ...cols]
    .map((c) => `${quoteIdent(c)} ${typeOf(c)}`)
    .join(", ");
  const sets = cols.map((c) => `${quoteIdent(c)} = v.${quoteIdent(c)}`);
  await sql.unsafe(
    `UPDATE ${quoteQualified(table)} AS t SET ${sets.join(", ")}
     FROM jsonb_to_recordset($1::jsonb) AS v(${defs})
     WHERE t.${quoteIdent(pk)} = v.${quoteIdent(pk)}`,
    // sql.json: postgres.js encodes it once for the jsonb param.
    [sql.json(payload as postgres.JSONValue)],
  );
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
  // The secret/session/token lists carry both a plural (the repo's own
  // NextAuth adapter schema) and a singular (legacy, pre-dating the current
  // adapter) table name; only one family exists in any given target, so an
  // absent member must be skipped rather than crash the run with an
  // undefined-table error — same contract as truncateTable().
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
 * carry both the repo's own NextAuth adapter's plural names and a legacy
 * singular family (pre-dating the current adapter); only one family exists
 * in any given target, so absent members must be skipped rather than crash
 * the run with an undefined-table error.
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
 * dropped from the set so a missing legacy-singular-family table doesn't abort
 * the run. */
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
 * prod carries singular-named legacy auth tables (auth.user,
 * auth.oauth_access_token, …) — leftovers from an earlier auth setup that
 * pre-dates the repo's current NextAuth adapter (packages/auth's
 * MDPGDrizzleAdapter, which reads/writes the repo's own plural
 * users/auth_accounts/auth_sessions/auth_verification_tokens tables). Not
 * written to by any active code path, but still physically present —
 * alongside the plural ones the repo schema defines — 4.9k raw emails and
 * 37k tokens would have sailed through silently. Schema drift must stop the
 * run, not leak.
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
  "public.orgs_x_slack_spaces",
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
  // Better Auth (migration 0022-0025, issue #876 phase 3). All 12 tables
  // classified below; see docs/STAGING_REFRESH.md for the per-column call.
  "auth.better_auth_user",
  "auth.better_auth_session",
  "auth.better_auth_account",
  "auth.better_auth_verification",
  "auth.better_auth_jwks",
  "auth.better_auth_oauth_client",
  "auth.better_auth_oauth_client_assertion",
  "auth.better_auth_oauth_client_resource",
  "auth.better_auth_oauth_resource",
  "auth.better_auth_oauth_consent",
  "auth.better_auth_oauth_access_token",
  "auth.better_auth_oauth_refresh_token",
  "auth.email_mfa_codes",
  "auth.email_mfa_code",
  "auth.oauth_clients",
  "auth.oauth_client",
  "auth.user",
  "auth.user_profiles",
]);

// Known, human-reviewed scope limit (same shape as "new columns default to
// leaks" in docs/STAGING_REFRESH.md): this only enumerates BASE TABLEs in the
// `public` and `auth` schemas. A future schema (e.g. a proposed `audit`
// schema for pre-obfuscation row snapshots) or a materialized view over PII
// columns would not be caught here or by either verify harness's leak sweep,
// which use the same filter. Not an active gap today — no matviews or extra
// schemas exist — but broaden this enumeration (pg_class/pg_namespace across
// all non-system schemas, including matviews) before either is introduced.
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

  // Read before any transform rewrites users.email: every later fakeEmail()
  // call maps a user's address to that user's sink+<id>.
  for (const row of await sql<{ id: number; email: string }[]>`
    SELECT id, email FROM users WHERE email IS NOT NULL`) {
    userIdByEmail.set(row.email.trim().toLowerCase(), row.id);
  }

  // ---- secrets: sessions, tokens, OAuth artifacts — truncate FIRST ----------
  // Deliberately runs before the PII transforms below (not after, as an
  // earlier version of this script did): none of these truncates/deletes
  // depend on the transforms having run, and a mid-run failure (network blip,
  // an unclassified table) then leaves every live session token, OAuth token,
  // and API key destroyed already — the safest state a partial run can be in
  // — rather than leaving them intact for the longest possible window.
  //
  // Both naming generations: the plural tables the repo's own NextAuth
  // adapter uses, and the singular legacy ones that still exist on prod.
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

  // Better Auth's secret-bearing tables. Grouped for the same reason as the
  // singular family above — oauth_refresh_token/oauth_access_token FK to
  // better_auth_session and to each other.
  //
  // - better_auth_session:            token + ip_address + user_agent
  // - better_auth_account:            access_token/refresh_token/id_token AND
  //                                   a `password` column
  // - better_auth_verification:       `identifier` is the email, `value` the
  //                                   OTP/verification token
  // - better_auth_jwks:               `private_key` — the signing keys for
  //                                   every token the auth app issues. These
  //                                   must never exist outside prod; Better
  //                                   Auth generates a fresh keypair on demand
  //                                   when the table is empty.
  // - better_auth_oauth_consent:      per-user grant state, meaningless once
  //                                   the tokens it authorised are gone
  // - better_auth_oauth_client_assertion: JTI replay guard, ephemeral by design
  await truncateTables(sql, [
    "auth.better_auth_oauth_access_token",
    "auth.better_auth_oauth_refresh_token",
    "auth.better_auth_oauth_consent",
    "auth.better_auth_oauth_client_assertion",
    "auth.better_auth_session",
    "auth.better_auth_account",
    "auth.better_auth_verification",
    "auth.better_auth_jwks",
  ]);

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

  // ---- Slack tables: not replicated -----------------------------------------
  // Prod's workspaces, members and org links are no use on staging (there is
  // no prod Slack workspace to talk to) and the staging slackbot acts on them:
  // the 2026-09-23 refresh had it regenerating prod regions' calendar images.
  // The load carries staging's own rows across instead (staging-slack.ts).
  // One statement: orgs_x_slack_spaces references slack_spaces.
  await truncateTables(sql, [
    "orgs_x_slack_spaces",
    "slack_spaces",
    "slack_users",
  ]);

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

  // Same prod -> staging repoint as better_auth_oauth_client (toStagingUri),
  // for both the plural table and the legacy singular one (same columns).
  // redirect_uris is a JSON array in a text column; allowed_origin is NOT
  // NULL, so an F3 origin with no staging twin becomes '' (matches no origin).
  for (const table of ["auth.oauth_clients", "auth.oauth_client"]) {
    await transformTable(sql, {
      table,
      pk: "id",
      columns: ["redirect_uris", "allowed_origin"],
      actions: {
        redirect_uris: "prod -> staging hosts (json)",
        allowed_origin: "prod -> staging host",
      },
      transform(row) {
        const changes: Row = {};
        let uris: unknown;
        try {
          uris = JSON.parse(row.redirect_uris as string);
        } catch {
          uris = null;
        }
        if (Array.isArray(uris) && uris.every((u) => typeof u === "string")) {
          const mapped = toStagingUris(uris);
          if (!sameStrings(mapped, uris)) {
            changes.redirect_uris = JSON.stringify(mapped);
          }
        }
        const origin = row.allowed_origin as string;
        const mappedOrigin = toStagingUri(origin) ?? "";
        if (mappedOrigin !== origin) changes.allowed_origin = mappedOrigin;
        return changes;
      },
    });
  }

  // ---- auth.oauth_client (singular, legacy): plaintext secret ---------------
  await runSetBased(sql, {
    table: "auth.oauth_client",
    column: "client_secret",
    action: "invalidate",
    countWhere: sql`true`,
    update: sql`UPDATE auth.oauth_client
        SET client_secret = 'revoked-' || encode(sha256(('revoked:' || id)::bytea), 'hex')`,
  });

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
      // A committed dev fixture keeps the identity fields local login reads
      // back (email / names). The "null out" columns below are not
      // identity — they're PII with no fake substitute — so they are cleared
      // even for fixtures, in case a fixture row picked up real values during
      // local testing.
      const isLocalFixture =
        PRESERVE_LOCAL_SEED &&
        !!email?.toLowerCase().endsWith(LOCAL_SEED_EMAIL_SUFFIX);
      const changes: Row = {};
      if (!isLocalFixture) {
        // Identity is rebuilt from users.id so any row is easy to trace back:
        // "F3 <id>", "First <id>", "Last <id>", sink+<id>. Null names stay
        // null (the apps treat a missing name differently from a present one).
        const id = String(row.id);
        const target = sinkAddress(id);
        if (email !== target) changes.email = target;
        const byCol: Record<string, string> = {
          f3_name: `F3 ${id}`,
          first_name: `First ${id}`,
          last_name: `Last ${id}`,
        };
        for (const [col, value] of Object.entries(byCol)) {
          const v = str(row[col]);
          if (v && v !== value) changes[col] = value;
        }
      }
      // Phone is faked even for fixtures: local login keys on email and
      // names only, and a fixture can pick up a real number through the
      // editable profile.
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
      if (email && !isAllowlistedEmail(email)) {
        changes.email = fakeEmail(email, `org-${String(row.id)}`);
      }
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
      if (email && !isAllowlistedEmail(email)) {
        changes.email = fakeEmail(email, `location-${String(row.id)}`);
      }
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
      if (email && !isAllowlistedEmail(email)) {
        changes.email = fakeEmail(email, `event-${String(row.id)}`);
      }
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
      "name",
      "description",
      "preblast",
      "backblast",
      "preblast_rich",
      "backblast_rich",
      "meta",
    ],
    actions: {
      email: "obfuscate (email)",
      // Real-data finding 2026-09-22: the slackbot titles some instances
      // after a Slack mention ("Q: <@U…>"), so name carries real Slack ids.
      name: "scrub emails (text)",
      description: "scrub emails (text)",
      preblast: "scrub emails (text)",
      backblast: "scrub emails (text)",
      preblast_rich: "scrub emails (json)",
      backblast_rich: "scrub emails (json)",
      meta: "scrub emails (json)",
    },
    where: sql`email IS NOT NULL
      OR name LIKE ${likeEmail}
      OR description LIKE ${likeEmail}
      OR preblast LIKE ${likeEmail}
      OR backblast LIKE ${likeEmail}
      OR preblast_rich::text LIKE ${likeEmail}
      OR backblast_rich::text LIKE ${likeEmail}
      OR meta::text LIKE ${likeEmail}`,
    transform: (row) => {
      const changes: Row = {};
      const email = str(row.email);
      if (email && !isAllowlistedEmail(email)) {
        changes.email = fakeEmail(email, `event-instance-${String(row.id)}`);
      }
      for (const col of ["name", "description", "preblast", "backblast"]) {
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
        changes[col] = v.includes("@")
          ? fakeEmail(v, `request-${String(row.id)}`)
          : fakeName(v);
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

  // ---- auth.user (legacy, singular) ------------------------------------------
  // Prod carries these legacy singular-named tables (pre-dating the repo's
  // current NextAuth adapter) alongside the plural ones the adapter actually
  // uses; this one holds live emails and real names.
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
      const email = row.email as string | null;
      // Legacy rows for a real user take that user's id-based identity.
      const userId = email
        ? userIdByEmail.get(email.trim().toLowerCase())
        : undefined;
      for (const col of ["name", "f3_name", "hospital_name"]) {
        const v = row[col] as string | null;
        if (!v) continue;
        changes[col] =
          userId !== undefined && col !== "hospital_name"
            ? `F3 ${userId}`
            : fakeName(`${col}:${v}`);
      }
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
      return v ? { hospital_name: fakeName(`hospital_name:${v}`) } : null;
    },
  });

  // ---- auth.better_auth_user -------------------------------------------------
  // Better Auth's shadow identity row, 1:1 with public.users. `id` is
  // String(public.users.id) (see apps/auth/src/lib/better-auth.ts's
  // databaseHooks.user.create.before), NOT an email — unlike the legacy
  // auth.user below — so it is a join key, not PII. It is preserved, and has
  // to be: f3_user_id is GENERATED ALWAYS AS ((id)::integer) STORED with an FK
  // to users.id, a unique constraint, and a CHECK that id matches
  // '^[1-9][0-9]*$' (migration 0024). Rewriting id would break all four.
  //
  // ORDERING NOTE: this must run AFTER the public.users transform, and does.
  // Migration 0025 installs an AFTER UPDATE OF email trigger on public.users
  // (auth.sync_better_auth_user_email) that rewrites better_auth_user.email
  // for the matching f3_user_id. Because f3_user_id is generated from id and
  // FK-enforced, EVERY row here is reachable by that trigger — so by the time
  // this job runs the emails are already fake and the allowlist guard makes
  // the email pass a no-op rather than faking a fake.
  //
  // The email pass is kept anyway as defence in depth, because the trigger is
  // not guaranteed to have run on the copy we are pointed at: a dump/restore
  // that replays data with session_replication_role = replica, a target
  // restored before migration 0025, or anyone dropping the trigger, all
  // silently leave the real email here. `name` and `image` have no trigger at
  // all and are always this job's work.
  await transformTable(sql, {
    table: "auth.better_auth_user",
    pk: "id",
    columns: ["name", "email", "image"],
    actions: {
      name: "obfuscate (name)",
      email: "obfuscate (email) (trigger-synced rows are already done)",
      image: "null out",
    },
    transform(row) {
      const changes: Row = {};
      const name = str(row.name);
      // id is String(users.id) by construction (see migration 0025).
      if (name) changes.name = `F3 ${String(row.id)}`;
      const email = str(row.email);
      // Better Auth lowercases every email it writes, and so does the trigger;
      // fakeEmail's output is already lowercase, so this stays consistent with
      // the users.email value it shadows.
      if (email && !isAllowlistedEmail(email)) changes.email = fakeEmail(email);
      if (row.image !== null) changes.image = null;
      return changes;
    },
  });

  // ---- auth.better_auth_oauth_client -----------------------------------------
  // Registered OAuth clients are kept (staging needs its client registrations
  // to exist), with the secret invalidated the same way auth.oauth_clients is.
  // `contacts` is RFC 7591's administrative-contact array — real email
  // addresses, and a text[] rather than text, so it needs element-wise
  // scrubbing. `jwks`/`jwks_uri` hold the CLIENT's public key set, which is
  // public by definition and left alone. Redirect and logout URIs are
  // repointed at staging (see toStagingUri).
  await transformTable(sql, {
    table: "auth.better_auth_oauth_client",
    pk: "id",
    columns: [
      "contacts",
      "metadata",
      "redirect_uris",
      "post_logout_redirect_uris",
      "backchannel_logout_uri",
    ],
    actions: {
      contacts: "scrub emails (text[])",
      metadata: "scrub emails (json)",
      redirect_uris: "prod -> staging hosts (text[])",
      post_logout_redirect_uris: "prod -> staging hosts (text[])",
      backchannel_logout_uri: "prod -> staging host",
    },
    transform(row) {
      const changes: Row = {};
      for (const col of ["redirect_uris", "post_logout_redirect_uris"]) {
        const uris = row[col] as string[] | null;
        if (!Array.isArray(uris)) continue;
        const mapped = toStagingUris(uris);
        if (!sameStrings(mapped, uris)) changes[col] = mapped;
      }
      const backchannel = row.backchannel_logout_uri as string | null;
      if (backchannel !== null) {
        const mapped = toStagingUri(backchannel);
        if (mapped !== backchannel) changes.backchannel_logout_uri = mapped;
      }
      const contacts = row.contacts as string[] | null;
      if (Array.isArray(contacts) && contacts.length > 0) {
        const scrubbed = contacts.map((c) =>
          typeof c === "string" ? scrubText(c) : c,
        );
        if (scrubbed.some((c, i) => c !== contacts[i])) {
          changes.contacts = scrubbed;
        }
      }
      if (row.metadata !== null) {
        const scrubbed = scrubJson(row.metadata);
        if (scrubbed !== row.metadata) {
          changes.metadata = JSON.stringify(scrubbed);
        }
      }
      return changes;
    },
  });

  await runSetBased(sql, {
    table: "auth.better_auth_oauth_client",
    column: "client_secret",
    action: "invalidate",
    countWhere: sql`client_secret IS NOT NULL`,
    update: sql`UPDATE auth.better_auth_oauth_client
        SET client_secret = encode(sha256(('revoked:' || id)::bytea), 'hex')
        WHERE client_secret IS NOT NULL`,
  });

  // ---- auth.better_auth_oauth_resource / _client_resource --------------------
  // Resource-server and client-resource registrations: configuration, not
  // personal data, but both carry free-form jsonb that operators can put
  // anything into, so the json columns get the same scrub as every other meta.
  await transformTable(sql, {
    table: "auth.better_auth_oauth_resource",
    pk: "id",
    columns: ["custom_claims", "metadata"],
    actions: {
      custom_claims: "scrub emails (json)",
      metadata: "scrub emails (json)",
    },
    transform(row) {
      const changes: Row = {};
      for (const col of ["custom_claims", "metadata"]) {
        if (row[col] === null) continue;
        const scrubbed = scrubJson(row[col]);
        if (scrubbed !== row[col]) changes[col] = JSON.stringify(scrubbed);
      }
      return changes;
    },
  });

  await transformTable(sql, {
    table: "auth.better_auth_oauth_client_resource",
    pk: "id",
    columns: ["metadata"],
    actions: { metadata: "scrub emails (json)" },
    transform(row) {
      if (row.metadata === null) return null;
      const scrubbed = scrubJson(row.metadata);
      return scrubbed === row.metadata
        ? null
        : { metadata: JSON.stringify(scrubbed) };
    },
  });

  // ---- auth.user.id: this legacy table keys users by EMAIL ADDRESS ----------
  // The primary key itself is PII (real-data finding, 2026-07-10). Rewrite ids
  // through the same memoized fakeEmail as the email columns, so id === email
  // consistency holds. Snapshot ids first (a keyset cursor over a mutating pk
  // would skip/revisit rows). NOTE: auth.user_profiles (unlike the truncated
  // secrets tables) is not rewritten here and may FK to auth.user.id — the
  // docs/STAGING_REFRESH.md hard-gate checklist covers verifying that.
  if (await tableExists(sql, "auth.user")) {
    const all = await sql<{ id: string }[]>`
      SELECT id FROM ${sql("auth.user")} ORDER BY id`;
    // fakeEmail dedups by case-NORMALIZED input, but auth.user carries
    // case-variant duplicates of the same email as distinct rows (e.g.
    // "John@Example.com" / "john@example.com") — those get the SAME fake
    // email (fakeEmail already ran as part of this table's own transform,
    // above) and so collide on id too. Track ids in use and lengthen the
    // (case-sensitive) hash until unique. ORDER BY id keeps it deterministic.
    //
    // Whichever duplicate needs a disambiguated id also gets its `email`
    // column overwritten to match: id === email must hold per-row, and the
    // disambiguated value is guaranteed unique across restrictions where the
    // plain fakeEmail() output collides with an id still in use.
    const used = new Set(all.map((r) => r.id));
    let n = 0;
    let skipped = 0;
    for (const { id } of all) {
      if (!id.includes("@") || isAllowlistedEmail(id)) {
        skipped += 1;
        continue;
      }
      let fake = fakeEmail(id);
      for (let length = 12; used.has(fake); length += 4) {
        if (length > MAX_HASH_HEX_LENGTH) {
          throw new Error(
            `auth.user.id disambiguation: exhausted hash length for "${id}"`,
          );
        }
        fake = sinkAddress(`ext-${hashHex(id, length)}`);
      }
      // Register the (possibly disambiguated) fake in the same map fakeEmail()
      // itself uses, so a later fakeEmail() call can't independently generate
      // and reissue this exact value for a different input.
      emailFakesInUse.set(fake, id.trim().toLowerCase());
      n += 1;
      if (!DRY_RUN) {
        await sql`
          UPDATE ${sql("auth.user")}
          SET id = ${fake}, email = ${fake}
          WHERE id = ${id}`;
      }
      used.delete(id);
      used.add(fake);
    }
    addSummary("auth.user", "id", "obfuscate (email-as-id)", n);
    if (skipped > 0) {
      addSummary(
        "auth.user",
        "id",
        "skip (non-email-shaped or allowlisted)",
        skipped,
      );
    }
  } else {
    addSummary(
      "auth.user",
      "id",
      "obfuscate (email-as-id) (table absent — skipped)",
      0,
    );
  }
}

// ---------------------------------------------------------------------------
// Safety rails + main
// ---------------------------------------------------------------------------

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

// Below this, brute-forcing the salt itself (rather than just rebuilding a
// rainbow table over candidate PII with a known salt) becomes the cheaper
// attack — 32 chars of a typical secret-manager-generated token is ~192 bits
// of entropy, comfortably out of reach.
const MIN_SALT_LENGTH = 32;

async function main(): Promise<void> {
  const salt = process.env.OBFUSCATION_SALT;
  if (!salt) {
    throw new Error(
      "Refusing to run: OBFUSCATION_SALT is not set. This must be a long, " +
        "random secret stored outside source control (e.g. the prod secret " +
        "manager), not a value committed to this (public) repo — see " +
        "docs/STAGING_REFRESH.md.",
    );
  }
  if (salt.length < MIN_SALT_LENGTH) {
    throw new Error(
      `Refusing to run: OBFUSCATION_SALT is ${salt.length} chars, below the ` +
        `${MIN_SALT_LENGTH}-char minimum. A short salt is guessable and ` +
        `defeats the point — generate one from the prod secret manager.`,
    );
  }
  SALT = salt;

  const sinkMatch = /^([a-z0-9._-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(
    EMAIL_SINK,
  );
  if (!sinkMatch) {
    throw new Error(
      `Refusing to run: --email-sink "${EMAIL_SINK}" must be a plain group address (no +tag).`,
    );
  }
  SINK_LOCAL = sinkMatch[1]!;
  SINK_DOMAIN = sinkMatch[2]!;

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

  const urlDbName = databaseNameFromUrl(databaseUrl);
  if (urlDbName !== ALLOW_DB) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at database "${urlDbName}" but --allow-db is "${ALLOW_DB}".`,
    );
  }
  if (looksLikeProdDbName(ALLOW_DB)) {
    throw new Error(
      `Refusing to run: database name "${ALLOW_DB}" is (or looks like) production. Obfuscate a copy, never the source.`,
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
