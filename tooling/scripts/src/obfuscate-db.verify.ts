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
 *      @obfuscated.f3nation.dev.
 *   2. Sessions / verification tokens / OAuth artifacts / api_keys are empty.
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
  "slack_users",
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
  "auth.oauth_authorization_codes",
  "auth.oauth_access_tokens",
  "auth.oauth_refresh_tokens",
  "auth.email_mfa_codes",
];

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const ALLOWED_EMAIL_SUFFIX = "@obfuscated.f3nation.dev";

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

  await sql`
    INSERT INTO slack_users (slack_id, user_name, email, is_admin, is_owner,
      is_bot, slack_team_id, strava_access_token, strava_refresh_token,
      avatar_url)
    VALUES ('U0REALSLACK', 'Jane Doe', 'jane@example.com', false, false,
      false, 'T0TEAM', 'strava-access-secret', 'strava-refresh-secret',
      'https://avatars.slack.com/jane.png')`;

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
          if (!match.toLowerCase().endsWith(ALLOWED_EMAIL_SUFFIX)) {
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
        (fakeUser?.email.endsWith(ALLOWED_EMAIL_SUFFIX) ?? false),
      `users.email=${fakeUser?.email} vs update_requests.submitted_by=${request?.submitted_by}`,
    );

    const [instance] = await sql<{ backblast: string | null }[]>`
      SELECT backblast FROM event_instances
      WHERE name = 'Synthetic Beatdown' LIMIT 1`;
    const backblastOk =
      !!instance?.backblast &&
      !instance.backblast.includes("bob.smith@yahoo.com") &&
      instance.backblast.includes(ALLOWED_EMAIL_SUFFIX);
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
