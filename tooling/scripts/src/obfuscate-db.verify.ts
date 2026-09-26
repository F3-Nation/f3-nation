/**
 * Verification harness for obfuscate-db.ts (F3-65, phase 1).
 *
 * Proves the obfuscator against the LOCAL SANDBOX SEED ONLY — never against
 * real data. It spins up a throwaway dockerized Postgres on port 5434, runs
 * migrations + the local seed, plants synthetic PII fixtures (real-looking
 * emails, phones, tokens, JSON meta), runs the obfuscator WITHOUT
 * --preserve-local-seed, then asserts:
 *
 *   1. No email-shaped string anywhere (public + auth schemas) except
 *      the shared email sink (dev.staging-email-sink+<tag>@f3nation.com).
 *   2. Sessions / verification tokens / OAuth artifacts / api_keys and the
 *      Slack tables (not replicated) are empty.
 *   3. Referential integrity: row counts unchanged for kept tables, and the
 *      same source email maps to the same fake across tables
 *      (users.email <-> update_requests.submitted_by).
 *   4. Free-text scrubbing rewrote the planted backblast email.
 *
 * Usage (from repo root or tooling/scripts):
 *   pnpm -F @acme/scripts obfuscate-db:verify
 *
 * Uses docker (postgres:18) when a daemon is available; otherwise falls back
 * to a throwaway local cluster via initdb/pg_ctl (still localhost:5434, still
 * ephemeral). Cleans up the instance and restores packages/env/.env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const CONTAINER = "f3-obfuscate-verify-pg";
const PORT = 5434;
const DB_NAME = "f3nation";
const DATABASE_URL = `postgresql://f3local:f3local@localhost:${PORT}/${DB_NAME}`;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const envFile = path.join(repoRoot, "packages/env/.env");

const KEPT_TABLES = [
  "users",
  "orgs",
  "locations",
  "events",
  "event_instances",
  "attendance",
  "update_requests",
  "positions",
  "event_types",
  "attendance_types",
  "event_tags",
];

const EMPTY_TABLES = [
  "auth_sessions",
  "auth_verification_tokens",
  "auth_accounts",
  "api_keys",
  "orgs_x_slack_spaces",
  "slack_spaces",
  "slack_users",
  "auth.oauth_authorization_codes",
  "auth.oauth_access_tokens",
  "auth.oauth_refresh_tokens",
  "auth.email_mfa_codes",
  "auth.better_auth_oauth_access_token",
  "auth.better_auth_oauth_refresh_token",
  "auth.better_auth_oauth_consent",
  "auth.better_auth_oauth_client_assertion",
  "auth.better_auth_session",
  "auth.better_auth_account",
  "auth.better_auth_verification",
  "auth.better_auth_jwks",
];

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// The obfuscator's default --email-sink; every rewritten address is a +tag on it.
const SINK_PREFIX = "dev.staging-email-sink+";
const SINK_SUFFIX = "@f3nation.com";

function isSinkAddress(email: string): boolean {
  const lower = email.toLowerCase();
  return lower.startsWith(SINK_PREFIX) && lower.endsWith(SINK_SUFFIX);
}
// Retina-image filenames (logo@2x.png) are email-shaped; not PII. Keep this
// in sync with the same guard in obfuscate-db.verify-target.ts.
const IMAGE_DENSITY_SUFFIX = /@\dx\.(?:png|jpe?g|gif|webp|svg)$/i;

function run(cmd: string, args: string[], env?: Record<string, string>) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  }
}

function docker(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8" });
  } catch (error) {
    if (opts.allowFail) return "";
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Throwaway Postgres backends: docker (preferred) or local initdb/pg_ctl
// ---------------------------------------------------------------------------

async function startDockerPostgres(): Promise<() => void> {
  docker(["rm", "-f", CONTAINER], { allowFail: true });
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_USER=f3local",
    "-e",
    "POSTGRES_PASSWORD=f3local",
    "-e",
    `POSTGRES_DB=${DB_NAME}`,
    "-p",
    `${PORT}:5432`,
    "postgres:18",
  ]);
  for (let i = 0; ; i++) {
    const ready = spawnSync("docker", [
      "exec",
      CONTAINER,
      "pg_isready",
      "-U",
      "f3local",
      "-d",
      DB_NAME,
    ]);
    if (ready.status === 0) break;
    if (i > 60) throw new Error("Postgres container never became ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`Postgres (docker) up on :${PORT}`);
  return () => {
    docker(["rm", "-f", CONTAINER], { allowFail: true });
    console.log("Removed docker container.");
  };
}

async function startLocalPostgres(): Promise<() => void> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "f3-obfuscate-verify-"));
  const logFile = path.join(dataDir, "postgres.log");
  execFileSync(
    "initdb",
    ["-D", dataDir, "-U", "f3local", "-A", "trust", "--no-sync"],
    { stdio: "ignore" },
  );
  execFileSync("pg_ctl", [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-o",
    `-p ${PORT} -c listen_addresses=127.0.0.1 -F`,
    "start",
  ]);
  for (let i = 0; ; i++) {
    const ready = spawnSync("pg_isready", [
      "-h",
      "127.0.0.1",
      "-p",
      String(PORT),
      "-U",
      "f3local",
    ]);
    if (ready.status === 0) break;
    if (i > 60) throw new Error("Local postgres never became ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  execFileSync("createdb", [
    "-h",
    "127.0.0.1",
    "-p",
    String(PORT),
    "-U",
    "f3local",
    DB_NAME,
  ]);
  console.log(`Postgres (local initdb, ${dataDir}) up on :${PORT}`);
  return () => {
    spawnSync("pg_ctl", ["-D", dataDir, "-m", "fast", "stop"]);
    try {
      rmSync(dataDir, { recursive: true, force: true });
      console.log("Stopped local postgres and removed its temp data dir.");
    } catch (err) {
      console.error(
        `Stopped local postgres, but failed to remove ${dataDir}:`,
        err,
      );
    }
  };
}

async function startPostgres(): Promise<() => void> {
  const dockerUp =
    spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  if (dockerUp) return startDockerPostgres();
  const hasInitdb =
    spawnSync("initdb", ["--version"], { stdio: "ignore" }).status === 0;
  if (!hasInitdb) {
    throw new Error(
      "Neither a docker daemon nor local postgres binaries (initdb/pg_ctl) are available.",
    );
  }
  console.log("Docker daemon unavailable — falling back to local initdb.");
  return startLocalPostgres();
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function plantSyntheticPii(
  sql: postgres.Sql,
): Promise<{ userId: number }> {
  console.log("\nPlanting synthetic PII fixtures...");
  const [region] = await sql<{ id: number }[]>`
    SELECT id FROM orgs WHERE org_type = 'region' ORDER BY id LIMIT 1`;
  const [ao] = await sql<{ id: number }[]>`
    SELECT id FROM orgs WHERE org_type = 'ao' ORDER BY id LIMIT 1`;
  if (!region || !ao) throw new Error("Seed data missing region/ao orgs");

  // A user with every PII field populated. jane@example.com also appears in
  // update_requests.submitted_by to prove cross-table consistency.
  const [user] = await sql<{ id: number }[]>`
    INSERT INTO users (f3_name, first_name, last_name, email, phone,
      avatar_url, emergency_contact, emergency_phone, emergency_notes, meta)
    VALUES ('Bluto', 'Jane', 'Doe', 'jane@example.com', '704-555-1234',
      'https://example.com/jane.jpg', 'John Doe', '704-555-9999',
      'Call john.doe@gmail.com if injured',
      '{"notes": "reach me at jane@example.com"}')
    RETURNING id`;
  if (!user) throw new Error("Failed to insert synthetic user");

  await sql`
    INSERT INTO auth_sessions (session_token, user_id, expires)
    VALUES ('super-secret-session-token', ${user.id}, now() + interval '30 days')`;
  await sql`
    INSERT INTO auth_verification_tokens (identifier, token, expires)
    VALUES ('jane@example.com', 'verification-token-123', now() + interval '1 day')`;
  await sql`
    INSERT INTO auth_accounts (user_id, type, provider, provider_account_id,
      refresh_token, access_token)
    VALUES (${user.id}, 'oauth', 'google', 'google-123',
      'oauth-refresh-secret', 'oauth-access-secret')`;
  await sql`
    INSERT INTO api_keys (key, name, description, owner_id)
    VALUES ('prod-secret-api-key-123', 'Prod Integration', 'secret', ${user.id})`;
  await sql`
    INSERT INTO auth.oauth_access_tokens (token, client_id, user_id, expires_at)
    VALUES ('oauth-at-secret', 'f3-me-local', ${user.id}, now() + interval '1 hour')`;
  await sql`
    INSERT INTO auth.oauth_refresh_tokens (token, client_id, user_id, expires_at)
    VALUES ('oauth-rt-secret', 'f3-me-local', ${user.id}, now() + interval '1 day')`;
  await sql`
    INSERT INTO auth.email_mfa_codes (id, email, code_hash, expires_at)
    VALUES (gen_random_uuid()::text, 'jane@example.com', 'deadbeef',
      now() + interval '10 minutes')`;

  await sql`
    INSERT INTO update_requests (region_id, event_name, request_type,
      submitted_by, event_contact_email, location_contact_email,
      event_description, meta)
    VALUES (${region.id}, 'Test Workout', 'create_event',
      'jane@example.com', 'siteq@hotmail.com', 'ao-contact@yahoo.com',
      'Questions? Ping siteq@hotmail.com',
      '{"contact": "jane@example.com", "note": "text 704-555-1234"}')`;

  await sql`
    INSERT INTO event_instances (org_id, is_active, highlight, start_date,
      name, email, backblast, meta)
    VALUES (${ao.id}, true, false, current_date, 'Synthetic Beatdown',
      'q-contact@gmail.com',
      'Great morning. FNG welcomed — reach bob.smith@yahoo.com to connect.',
      '{"mumblechatter": "email carl@aol.com"}')`;

  // No email anywhere in this row — proves the row-selection WHERE clause
  // (keyed on a bare "%@%" LIKE) still catches Slack mention syntax on its
  // own, since "<@U...>" itself contains "@".
  await sql`
    INSERT INTO event_instances (org_id, is_active, highlight, start_date,
      name, backblast_rich)
    VALUES (${ao.id}, true, false, current_date, 'Mention-Only Beatdown',
      '{"type": "mrkdwn", "text": "<@U0REALSLACK> led 20 burpees"}')`;

  // The pipe form Slack emits when the readable name is inlined, plus an
  // enterprise-grid `W` member id. Both the id and the display name after
  // the pipe are real PII and must not survive.
  await sql`
    INSERT INTO event_instances (org_id, is_active, highlight, start_date,
      name, backblast)
    VALUES (${ao.id}, true, false, current_date, 'Pipe-Mention Beatdown',
      'Q was <@U0PIPEFORM|bob.smith>, co-Q <@W0GRIDUSER|Grid Person>.')`;

  await sql`
    INSERT INTO slack_users (slack_id, user_name, email, is_admin, is_owner,
      is_bot, slack_team_id, strava_access_token, strava_refresh_token,
      avatar_url)
    VALUES ('U0REALSLACK', 'Jane Doe', 'jane@example.com', false, false,
      false, 'T0TEAM', 'strava-access-secret', 'strava-refresh-secret',
      'https://avatars.slack.com/jane.png')`;

  // Prod's Slack tables are emptied, not scrubbed: a workspace with a live
  // bot token, linked to a real region, must not survive the run.
  const [space] = await sql<{ id: number }[]>`
    INSERT INTO slack_spaces (team_id, workspace_name, bot_token, settings)
    VALUES ('T0TEAM', 'F3 Real Region', 'xoxb-real-bot-token',
      '{"admin_email": "jane@example.com"}')
    RETURNING id`;
  if (!space) throw new Error("Failed to insert synthetic slack space");
  await sql`
    INSERT INTO orgs_x_slack_spaces (org_id, slack_space_id)
    VALUES (${region.id}, ${space.id})`;

  // Better Auth shadow row, 1:1 with the users row above. f3_user_id is a
  // GENERATED ALWAYS column ((id)::integer) with an FK to users.id and a
  // CHECK that id is a canonical positive integer, so it cannot be inserted
  // and an "orphan" shadow row is not constructible -- every row here is
  // reachable by migration 0025's email-sync trigger. That is exactly what
  // makes this fixture worth planting: it proves the trigger and the
  // obfuscator agree, and that name/image (which no trigger touches) are
  // cleared by the script itself.
  await sql`
    INSERT INTO auth.better_auth_user (id, name, email, email_verified, image,
      created_at, updated_at)
    VALUES (${String(user.id)}, 'Jane Doe', 'jane@example.com', true,
      'https://example.com/jane-shadow.jpg', now(), now())`;

  // A Better Auth OAuth client. Without this the contacts/metadata/secret
  // jobs run against 0 rows every time -- and `contacts` is a text[], the
  // only array column this script scrubs, so it is the least-like-anything-
  // else code path in the file.
  await sql`
    INSERT INTO auth.better_auth_oauth_client (id, client_id, client_secret,
      name, redirect_uris, post_logout_redirect_uris, backchannel_logout_uri,
      contacts, metadata)
    VALUES ('synthetic-client', 'synthetic-client-id', 'super-secret-value',
      'Synthetic Client',
      ARRAY['https://example.com/cb', 'https://map.f3nation.com/api/auth/callback',
        'https://pax-vault.f3nation.com/cb', 'http://localhost:3000/cb'],
      ARRAY['https://auth.f3nation.com/logged-out'],
      'https://admin.f3nation.com/api/auth/backchannel',
      ARRAY['admin@example.com', 'ops@example.com'],
      '{"owner_email": "carl@aol.com"}')`;

  // A legacy (NextAuth-era) client with prod URIs: redirect_uris is a JSON
  // array in a text column and allowed_origin is a bare origin, so both
  // exercise different code than the text[] columns above.
  await sql`
    INSERT INTO auth.oauth_clients (id, name, client_secret_hash,
      redirect_uris, allowed_origin)
    VALUES ('synthetic-legacy-client', 'Synthetic Legacy', 'x',
      '["https://me.f3nation.com/api/auth/callback","https://regions.f3nation.com/cb"]',
      'https://me.f3nation.com')`;

  // Retina-density asset filename: email-shaped but not PII, and untouched
  // by the obfuscator (orgs.logo_url is not a scrubbed column). Exercises
  // the IMAGE_DENSITY_SUFFIX guard in sweepForEmails rather than leaving it
  // as an untested mirror of the one in obfuscate-db.verify-target.ts.
  await sql`
    UPDATE orgs SET logo_url = 'https://cdn.f3nation.com/logo@2x.png'
    WHERE id = ${region.id}`;

  console.log("  Planted user, session, tokens, api key, request, backblast.");
  return { userId: user.id };
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

async function sweepForEmails(
  sql: postgres.Sql,
): Promise<{ violations: string[]; columnsScanned: number }> {
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
  for (const col of columns) {
    const qualified = `${col.table_schema === "public" ? "" : `${col.table_schema}.`}${col.table_name}`;
    const isJson = col.data_type === "json" || col.data_type === "jsonb";
    const rows = await sql<{ v: string | null }[]>`
      SELECT ${sql(col.column_name)}::text AS v FROM ${sql(qualified)}
      WHERE ${sql(col.column_name)}::text LIKE '%@%'`;
    for (const row of rows) {
      if (row.v === null) continue;
      // Regexing a jsonb column's raw ::text serialization risks false
      // matches around backslash-escapes; parse and scan actual string
      // leaves instead, same as obfuscate-db.verify-target.ts.
      const texts = isJson ? stringLeaves(JSON.parse(row.v), []) : [row.v];
      for (const text of texts) {
        for (const match of text.match(EMAIL_REGEX) ?? []) {
          if (IMAGE_DENSITY_SUFFIX.test(match)) continue;
          if (!isSinkAddress(match)) {
            violations.push(`${qualified}.${col.column_name}: ${match}`);
          }
        }
      }
    }
  }
  return { violations, columnsScanned: columns.length };
}

async function main(): Promise<void> {
  console.log("=== obfuscate-db verification harness (sandbox seed only) ===");

  // --- 1. Throwaway Postgres ------------------------------------------------
  const stopPostgres = await startPostgres();

  // --- 2. Migrate + seed (same recipe as preview-env.yml) --------------------
  const envBackup = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
  writeFileSync(envFile, `DATABASE_URL=${DATABASE_URL}\n`);

  // We overwrite the developer's real packages/env/.env for the child processes.
  // The finally below restores it on the normal path, but an abrupt SIGINT/
  // SIGTERM (Ctrl-C) skips finally — restore on those signals too so we never
  // leave their env file replaced. Idempotent so the finally can also call it.
  let envRestored = false;
  let envRestoreFailed = false;
  const restoreEnv = (): void => {
    if (envRestored) return;
    envRestored = true;
    try {
      if (envBackup === null) {
        if (existsSync(envFile)) unlinkSync(envFile);
      } else {
        writeFileSync(envFile, envBackup);
      }
    } catch (err) {
      // Not actually best-effort-recoverable: if this fails, the developer's
      // real packages/env/.env is left pointed at a torn-down sandbox
      // Postgres. Loud, since nothing here can retry it.
      envRestoreFailed = true;
      console.error(
        `FAILED to restore ${envFile} — it may still point at the ` +
          `now-stopped sandbox Postgres. Restore it manually.`,
        err,
      );
    }
  };
  const onSignal = (): void => {
    restoreEnv();
    try {
      stopPostgres();
    } catch {
      // best effort
    }
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    const childEnv = {
      CI: "",
      SKIP_ENV_VALIDATION: "1",
      DATABASE_URL,
      // obfuscate-db.ts now requires this (a committed salt let anyone
      // rebuild a rainbow table against the public repo). This harness only
      // ever touches a throwaway sandbox database, so a fixed test value is
      // fine here — real runs must use a real secret from the prod secret
      // manager, never this one.
      OBFUSCATION_SALT: "sandbox-verify-harness-test-salt-not-for-real-use",
    };
    run("pnpm", ["db:migrate"], childEnv);
    run("pnpm", ["db:seed:local"], childEnv);

    // --- 3. Synthetic PII + pre-counts --------------------------------------
    const { userId } = await plantSyntheticPii(sql);

    const preCounts = new Map<string, number>();
    for (const table of KEPT_TABLES) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)}`;
      preCounts.set(table, row?.n ?? 0);
    }

    const { violations: preViolations } = await sweepForEmails(sql);
    console.log(
      `\nPre-obfuscation sweep: ${preViolations.length} real-looking email value(s) present (expected > 0).`,
    );
    if (preViolations.length === 0) {
      throw new Error("Harness bug: expected planted PII before obfuscation");
    }

    // --- 3b. Stash the target's own API keys ------------------------------------
    // On a real refresh the stash runs on staging before the load; here the
    // sandbox plays both roles. Restored in 5c after the logins exist.
    const [keysBefore] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM api_keys`;
    run(
      "pnpm",
      [
        "-F",
        "@acme/scripts",
        "exec",
        "tsx",
        "src/staging-api-keys.ts",
        "--allow-db",
        DB_NAME,
        "--stash",
      ],
      childEnv,
    );

    // --- 4. Run the obfuscator (NO --preserve-local-seed) --------------------
    run(
      "pnpm",
      [
        "-F",
        "@acme/scripts",
        "exec",
        "tsx",
        "src/obfuscate-db.ts",
        "--allow-db",
        DB_NAME,
        "--i-understand-this-rewrites-data",
      ],
      childEnv,
    );

    // --- 5. Assertions --------------------------------------------------------
    console.log("\nAssertions:");

    const { violations, columnsScanned } = await sweepForEmails(sql);
    check(
      "email sweep",
      violations.length === 0,
      violations.length === 0
        ? `0 non-obfuscated emails across ${columnsScanned} text/json columns (public + auth)`
        : `${violations.length} leaked: ${violations.slice(0, 5).join("; ")}`,
    );

    for (const table of EMPTY_TABLES) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)}`;
      check(`${table} empty`, row?.n === 0, `${row?.n ?? "?"} rows`);
    }

    let countsOk = true;
    const countDetails: string[] = [];
    for (const table of KEPT_TABLES) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)}`;
      const before = preCounts.get(table) ?? -1;
      if (row?.n !== before) {
        countsOk = false;
        countDetails.push(`${table}: ${before} -> ${row?.n ?? "?"}`);
      }
    }
    check(
      "kept-table row counts unchanged",
      countsOk,
      countsOk
        ? `${KEPT_TABLES.length} tables identical`
        : countDetails.join("; "),
    );

    const [named] = await sql<
      {
        f3_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }[]
    >`SELECT f3_name, first_name, last_name FROM users WHERE id = ${userId}`;
    check(
      "planted user renamed to F3/First/Last <id>",
      named?.f3_name === `F3 ${userId}` &&
        named.first_name === `First ${userId}` &&
        named.last_name === `Last ${userId}`,
      `${named?.f3_name} / ${named?.first_name} / ${named?.last_name}`,
    );

    // Deterministic cross-table consistency: jane@example.com must map to the
    // same fake in users.email and update_requests.submitted_by.
    const [fakeUser] = await sql<{ email: string }[]>`
      SELECT email FROM users WHERE id = ${userId}`;
    const [request] = await sql<{ submitted_by: string }[]>`
      SELECT submitted_by FROM update_requests
      WHERE event_name = 'Test Workout' LIMIT 1`;
    check(
      "deterministic cross-table email mapping",
      fakeUser?.email === request?.submitted_by &&
        fakeUser?.email === `${SINK_PREFIX}${userId}${SINK_SUFFIX}`,
      `users.email=${fakeUser?.email} vs update_requests.submitted_by=${request?.submitted_by}`,
    );

    const [instance] = await sql<{ backblast: string | null }[]>`
      SELECT backblast FROM event_instances
      WHERE name = 'Synthetic Beatdown' LIMIT 1`;
    const backblastOk =
      !!instance?.backblast &&
      !instance.backblast.includes("bob.smith@yahoo.com") &&
      instance.backblast.includes(SINK_PREFIX);
    check(
      "free-text backblast scrubbed",
      backblastOk,
      instance?.backblast ?? "missing",
    );

    const [mentionRow] = await sql<{ backblast_rich: string | null }[]>`
      SELECT backblast_rich::text AS backblast_rich FROM event_instances
      WHERE name = 'Mention-Only Beatdown' LIMIT 1`;
    const mentionOk =
      !!mentionRow?.backblast_rich &&
      !mentionRow.backblast_rich.includes("U0REALSLACK") &&
      mentionRow.backblast_rich.includes("<@U");
    check(
      "Slack mention in JSON scrubbed with no email present",
      mentionOk,
      mentionRow?.backblast_rich ?? "missing",
    );

    const [pipeRow] = await sql<{ backblast: string | null }[]>`
      SELECT backblast FROM event_instances
      WHERE name = 'Pipe-Mention Beatdown' LIMIT 1`;
    const pipeText = pipeRow?.backblast ?? "";
    const pipeOk =
      !!pipeRow?.backblast &&
      // Neither member id survives...
      !pipeText.includes("U0PIPEFORM") &&
      !pipeText.includes("W0GRIDUSER") &&
      // ...nor the display name Slack inlined after the pipe...
      !pipeText.includes("bob.smith") &&
      !pipeText.includes("Grid Person") &&
      // ...and the replacement emits the bare form, so no pipe remains.
      !pipeText.includes("|") &&
      (pipeText.match(/<@U[A-Z0-9]+>/g) ?? []).length === 2;
    check("piped/enterprise Slack mentions scrubbed", pipeOk, pipeText);

    const [shadow] = await sql<
      { id: string; name: string; email: string; image: string | null }[]
    >`
      SELECT id, name, email, image FROM auth.better_auth_user
      WHERE id = ${String(userId)} LIMIT 1`;
    const shadowOk =
      !!shadow &&
      isSinkAddress(shadow.email) &&
      !shadow.name.includes("Jane Doe") &&
      shadow.image === null;
    check(
      "better_auth_user shadow row obfuscated (name/image by the script)",
      shadowOk,
      shadow ? `${shadow.email} / ${shadow.name} / ${shadow.image}` : "missing",
    );

    // The trigger and the obfuscator must agree, or a staging sign-in lands on
    // a shadow row whose email no longer matches users.email and the user is
    // locked out -- the exact failure migration 0025 exists to prevent.
    const [triggerMatch] = await sql<{ matched: boolean }[]>`
      SELECT (u.email = b.email) AS matched
      FROM users u JOIN auth.better_auth_user b ON b.f3_user_id = u.id
      WHERE u.id = ${userId} LIMIT 1`;
    check(
      "users.email and its better_auth_user shadow still agree",
      triggerMatch?.matched === true,
      String(triggerMatch?.matched),
    );

    const [client] = await sql<
      {
        contacts: string[] | null;
        metadata: string | null;
        client_secret: string | null;
        expected_secret: string;
      }[]
    >`
      SELECT contacts, metadata::text AS metadata, client_secret,
        encode(sha256(('revoked:' || id)::bytea), 'hex') AS expected_secret
      FROM auth.better_auth_oauth_client WHERE id = 'synthetic-client' LIMIT 1`;
    const clientOk =
      !!client &&
      (client.contacts ?? []).length === 2 &&
      (client.contacts ?? []).every((c) => isSinkAddress(c)) &&
      !!client.metadata &&
      !client.metadata.includes("carl@aol.com") &&
      client.metadata.includes(SINK_PREFIX) &&
      client.client_secret === client.expected_secret;
    check(
      "better_auth_oauth_client contacts[]/metadata scrubbed, secret invalidated",
      clientOk,
      client
        ? `${(client.contacts ?? []).join(",")} | ${client.metadata} | secret ${client.client_secret === client.expected_secret ? "invalidated" : "INTACT"}`
        : "missing",
    );

    // Prod F3 hosts repointed at staging, unknown F3 prod hosts dropped,
    // third-party and localhost URIs untouched, bare origin kept bare.
    const [uris] = await sql<
      {
        redirect_uris: string[];
        post_logout_redirect_uris: string[] | null;
        backchannel_logout_uri: string | null;
      }[]
    >`
      SELECT redirect_uris, post_logout_redirect_uris, backchannel_logout_uri
      FROM auth.better_auth_oauth_client WHERE id = 'synthetic-client'`;
    const [legacy] = await sql<
      { redirect_uris: string; allowed_origin: string }[]
    >`
      SELECT redirect_uris, allowed_origin FROM auth.oauth_clients
      WHERE id = 'synthetic-legacy-client'`;
    const expectedRedirects = [
      "https://example.com/cb",
      "https://staging.map.f3nation.com/api/auth/callback",
      "http://localhost:3000/cb",
    ];
    const urisOk =
      !!uris &&
      JSON.stringify(uris.redirect_uris) ===
        JSON.stringify(expectedRedirects) &&
      JSON.stringify(uris.post_logout_redirect_uris) ===
        JSON.stringify(["https://staging.auth2.f3nation.com/logged-out"]) &&
      uris.backchannel_logout_uri ===
        "https://staging.admin.f3nation.com/api/auth/backchannel" &&
      !!legacy &&
      legacy.redirect_uris ===
        JSON.stringify(["https://staging.me.f3nation.com/api/auth/callback"]) &&
      legacy.allowed_origin === "https://staging.me.f3nation.com";
    check(
      "OAuth client URIs repointed prod -> staging",
      urisOk,
      `${JSON.stringify(uris)} | ${JSON.stringify(legacy)}`,
    );

    const [logoRow] = await sql<{ logo_url: string | null }[]>`
      SELECT logo_url FROM orgs
      WHERE logo_url LIKE '%@2x.png' LIMIT 1`;
    check(
      "retina asset filename survives the email sweep (not PII)",
      logoRow?.logo_url === "https://cdn.f3nation.com/logo@2x.png",
      logoRow?.logo_url ?? "missing",
    );

    // FK spot-check: every attendance row still resolves to a user + instance.
    const [orphans] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM attendance a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN event_instances ei ON ei.id = a.event_instance_id
      WHERE u.id IS NULL OR ei.id IS NULL`;
    check(
      "attendance FKs intact",
      orphans?.n === 0,
      `${orphans?.n ?? "?"} orphaned rows`,
    );

    // --- 5a. Unclassified-table gate ------------------------------------------
    // The gate has fired for real (Better Auth schema drift), but only its
    // pass path ran here. Add an unclassified table, plant a real-looking
    // email the obfuscator would rewrite, re-run, and require a non-zero exit
    // with the users table byte-for-byte unchanged (nothing written).
    const [prior] = await sql<{ email: string }[]>`
      SELECT email FROM users WHERE id = ${userId}`;
    await sql`CREATE TABLE public._unclassified_gate_test (id int)`;
    await sql`
      UPDATE users SET email = 'gate-sentinel@example.com'
      WHERE id = ${userId}`;
    const usersHash = async () => {
      const [row] = await sql<{ h: string }[]>`
        SELECT md5(string_agg(u::text, '|' ORDER BY id)) AS h FROM users u`;
      return row?.h ?? "";
    };
    const before = await usersHash();
    const gateRun = spawnSync(
      "pnpm",
      [
        "-F",
        "@acme/scripts",
        "exec",
        "tsx",
        "src/obfuscate-db.ts",
        "--allow-db",
        DB_NAME,
        "--i-understand-this-rewrites-data",
      ],
      { cwd: repoRoot, env: { ...process.env, ...childEnv }, stdio: "pipe" },
    );
    const after = await usersHash();
    // Name the table in the reason, so an unrelated failure (bad env, a
    // crash) can't pass for the gate.
    const gateFired =
      `${gateRun.stdout.toString()}${gateRun.stderr.toString()}`.includes(
        "classified: public._unclassified_gate_test",
      );
    check(
      "unclassified table aborts the run before any write",
      gateRun.status !== 0 && gateFired && before === after,
      `exit ${gateRun.status}, gate ${gateFired ? "fired" : "DID NOT FIRE"}, users ${before === after ? "unchanged" : "REWRITTEN"}`,
    );
    await sql`DROP TABLE public._unclassified_gate_test`;
    await sql`UPDATE users SET email = ${prior?.email ?? ""} WHERE id = ${userId}`;

    // --- 5c. Restore only the named API keys -----------------------------------
    // Without --keep the restore refuses and changes nothing.
    const scripts = (script: string, args: string[]) =>
      spawnSync(
        "pnpm",
        ["-F", "@acme/scripts", "exec", "tsx", `src/${script}`, ...args],
        { cwd: repoRoot, env: { ...process.env, ...childEnv }, stdio: "pipe" },
      );
    const refused = scripts("staging-api-keys.ts", [
      "--allow-db",
      DB_NAME,
      "--restore",
    ]);
    const [stillStashed] = await sql<{ stash: boolean; n: number }[]>`
      SELECT to_regnamespace('refresh_keep') IS NOT NULL AS stash,
        (SELECT count(*)::int FROM api_keys) AS n`;
    check(
      "API key restore refuses without --keep",
      refused.status !== 0 &&
        refused.stderr.toString().includes("without --keep") &&
        !!stillStashed?.stash &&
        stillStashed.n === 0,
      `exit ${refused.status}, stash ${stillStashed?.stash ? "kept" : "GONE"}, ${stillStashed?.n ?? "?"} key(s) in api_keys`,
    );

    const keepNames = ["Map App (local dev)", "Slackbot (local dev)"];
    run(
      "pnpm",
      [
        "-F",
        "@acme/scripts",
        "exec",
        "tsx",
        "src/staging-api-keys.ts",
        "--allow-db",
        DB_NAME,
        "--restore",
        ...keepNames.flatMap((name) => ["--keep", name]),
      ],
      childEnv,
    );
    const keysAfter = await sql<{ name: string }[]>`
      SELECT name FROM api_keys ORDER BY name`;
    const [stashAfter] = await sql<{ stash: boolean; grants: number }[]>`
      SELECT to_regnamespace('refresh_keep') IS NOT NULL AS stash,
        (SELECT count(*)::int FROM roles_x_api_keys_x_org) AS grants`;
    const [slackbotGrants] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM roles_x_api_keys_x_org g
      JOIN api_keys k ON k.id = g.api_key_id
      WHERE k.name = 'Slackbot (local dev)'`;
    const restoredNames = keysAfter.map((k) => k.name);
    check(
      "only the --keep API keys survive the refresh",
      (keysBefore?.n ?? 0) > keepNames.length &&
        JSON.stringify(restoredNames) === JSON.stringify(keepNames) &&
        stashAfter?.grants === slackbotGrants?.n &&
        (slackbotGrants?.n ?? 0) > 0 &&
        stashAfter?.stash === false,
      `${keysBefore?.n ?? "?"} stashed, restored [${restoredNames.join(", ")}], ${stashAfter?.grants ?? "?"} grant(s), stash ${stashAfter?.stash ? "LEFT BEHIND" : "dropped"}`,
    );

    // --- 5d. Staging's own Slack data survives the refresh ---------------------
    // The obfuscator emptied prod's Slack tables above. Plant staging's own
    // workspace, stash it, empty the tables as the load does, restore.
    const [stagingSpace] = await sql<{ id: number }[]>`
      INSERT INTO slack_spaces (team_id, workspace_name, bot_token)
      VALUES ('T0STAGING', 'App Pioneers', 'xoxb-staging-bot-token')
      RETURNING id`;
    if (!stagingSpace) throw new Error("Failed to insert staging workspace");
    const [linkOrg] = await sql<{ id: number }[]>`
      SELECT id FROM orgs WHERE org_type = 'region' ORDER BY id LIMIT 1`;
    if (!linkOrg) throw new Error("Seed data missing a region org");
    await sql`
      INSERT INTO orgs_x_slack_spaces (org_id, slack_space_id)
      VALUES (${linkOrg.id}, ${stagingSpace.id})`;
    await sql`
      INSERT INTO slack_users (slack_id, user_name, email, is_admin, is_owner,
        is_bot, slack_team_id, user_id)
      VALUES
        ('U0SINKED', 'F3 1', ${`${SINK_PREFIX}1${SINK_SUFFIX}`}, false, false,
          false, 'T0STAGING', 1),
        ('U0SYNCED', 'Real Person', 'real.person@example.com', false, false,
          false, 'T0STAGING', 1)`;
    run(
      "pnpm",
      [
        "-F",
        "@acme/scripts",
        "exec",
        "tsx",
        "src/staging-slack.ts",
        "--allow-db",
        DB_NAME,
        "--stash",
      ],
      childEnv,
    );
    // A member whose user and a link whose org the next copy won't have.
    await sql`
      UPDATE refresh_keep_slack.slack_users SET user_id = 999999
      WHERE slack_id = 'U0SINKED'`;
    await sql`
      INSERT INTO refresh_keep_slack.orgs_x_slack_spaces (org_id, slack_space_id)
      VALUES (999999, ${stagingSpace.id})`;
    await sql`TRUNCATE orgs_x_slack_spaces, slack_spaces, slack_users`;
    const slackRestore = scripts("staging-slack.ts", [
      "--allow-db",
      DB_NAME,
      "--restore",
    ]);
    const slackOut = slackRestore.stdout.toString();
    const [slackAfter] = await sql<
      {
        spaces: number;
        members: number;
        links: number;
        nulled: number;
        stash: boolean;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM slack_spaces WHERE team_id = 'T0STAGING') AS spaces,
        (SELECT count(*)::int FROM slack_users) AS members,
        (SELECT count(*)::int FROM orgs_x_slack_spaces
          WHERE org_id = ${linkOrg.id} AND slack_space_id = ${stagingSpace.id}) AS links,
        (SELECT count(*)::int FROM slack_users
          WHERE slack_id = 'U0SINKED' AND user_id IS NULL) AS nulled,
        to_regnamespace('refresh_keep_slack') IS NOT NULL AS stash`;
    check(
      "staging's own Slack data survives the refresh",
      slackRestore.status === 0 &&
        slackAfter?.spaces === 1 &&
        slackAfter.members === 2 &&
        slackAfter.links === 1 &&
        slackAfter.nulled === 1 &&
        !slackAfter.stash &&
        slackOut.includes("workspace T0STAGING -> org 999999") &&
        slackOut.includes("Warning: 1 restored Slack member(s)") &&
        !slackOut.includes("real.person@example.com"),
      `exit ${slackRestore.status}, ${slackAfter?.spaces ?? "?"} workspace, ${slackAfter?.members ?? "?"} member(s), ${slackAfter?.links ?? "?"} link, ${slackAfter?.nulled ?? "?"} unlinked member, stash ${slackAfter?.stash ? "LEFT BEHIND" : "dropped"}`,
    );

    // --- 6. Verdict -----------------------------------------------------------
    const failed = results.filter((r) => !r.pass);
    console.log("\n=== VERIFICATION SUMMARY ===");
    for (const r of results) {
      console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    }
    console.log(
      failed.length === 0
        ? `\nALL ${results.length} CHECKS PASSED — sandbox seed only; human review required before any real-data run.`
        : `\n${failed.length}/${results.length} CHECKS FAILED`,
    );
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // best effort — cleanup below must still run even if the backend
      // already went away (restoreEnv/stopPostgres would otherwise never
      // run, leaving the developer's packages/env/.env overwritten and the
      // container/temp cluster still running on port 5434)
    }
    restoreEnv();
    stopPostgres();
    console.log(
      envRestoreFailed
        ? "Stopped throwaway postgres, but packages/env/.env restore FAILED — see above."
        : "Cleaned up throwaway postgres and packages/env/.env.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
