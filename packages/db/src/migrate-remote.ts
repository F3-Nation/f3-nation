/**
 * `pnpm db:migrate:staging` / `pnpm db:migrate:prod`: apply main's pending
 * migrations to staging or prod, with guards (migrate-guards.ts).
 *
 * Never reads packages/db/.env. The migration login's URL comes from Google
 * Secret Manager (MIGRATE_DATABASE_URL_STAGING / MIGRATE_DATABASE_URL_PROD in
 * project f3data, read with your own gcloud login) and is never printed.
 * Overrides, for unusual cases: MIGRATE_DATABASE_URL (use this URL instead),
 * MIGRATE_SECRET / MIGRATE_SECRET_PROJECT (read a different secret).
 *
 * In order, refusing with what to do at the first failure:
 *   1. run by a person in a terminal (it asks for confirmation);
 *   2. packages/db/drizzle is main's (git fetch first), no local changes;
 *   3. the URL names exactly f3_staging / f3_prod, so the migrations table
 *      is the one the environment has always used;
 *   4. read-only: the server's current_database() is that database, the login
 *      owns the schema objects, and the database's migration rows agree with
 *      main's journal (planMigrations);
 *   5. shows the pending migrations and asks you to type the database name.
 * Then it runs Drizzle's migrator, which applies them in one transaction.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type {
  AppliedRow,
  GitState,
  JournalEntry,
  RemoteEnvironment,
} from "./migrate-guards";
import {
  checkGitState,
  checkPlan,
  confirmationMatches,
  DEFAULT_SECRET_PROJECT,
  ENVIRONMENTS,
  planMigrations,
} from "./migrate-guards";
import { migrationsDatabaseName, postgresArgs } from "./utils/functions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");
const MIGRATIONS_PATH = "packages/db/drizzle";

class Refusal extends Error {}

function git(
  cwd: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/** The remote that is F3-Nation/f3-nation (origin, or upstream in a fork). */
export function findMainRemote(repoRoot: string): string | undefined {
  const remotes = git(repoRoot, ["remote", "-v"]).stdout.split("\n");
  for (const line of remotes) {
    const [name, url] = line.split(/\s+/);
    if (name && url && /[/:]F3-Nation\/f3-nation(?:\.git)?$/i.test(url)) {
      return name;
    }
  }
  return undefined;
}

/**
 * The git facts checkGitState needs, comparing with `<remote>/main` (fetch it
 * first). Exported for tests, which run it on a throwaway repository.
 */
export function readGitState(repoRoot: string, mainRef: string): GitState {
  const diff = git(repoRoot, [
    "diff",
    "--quiet",
    mainRef,
    "--",
    MIGRATIONS_PATH,
  ]);
  if (diff.status > 1)
    throw new Refusal(`git diff failed: ${diff.stderr.trim()}`);
  const status = git(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    MIGRATIONS_PATH,
  ]);
  const ancestor = git(repoRoot, [
    "merge-base",
    "--is-ancestor",
    "HEAD",
    mainRef,
  ]);
  return {
    differsFromMain: diff.status === 1,
    localChanges: status.stdout
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => l.trim()),
    headOnMain: ancestor.status === 0,
  };
}

function migrationUrl(target: RemoteEnvironment): string {
  const override = process.env.MIGRATE_DATABASE_URL;
  if (override) {
    console.log("Using MIGRATE_DATABASE_URL from your environment.");
    return override.trim();
  }
  const secret = process.env.MIGRATE_SECRET ?? ENVIRONMENTS[target].secret;
  const project = process.env.MIGRATE_SECRET_PROJECT ?? DEFAULT_SECRET_PROJECT;
  const res = spawnSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      secret,
      "--project",
      project,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (res.error) {
    throw new Refusal(
      "gcloud isn't installed or isn't on your PATH. Install the Google Cloud CLI and run `gcloud auth login`.",
    );
  }
  if (res.status !== 0) {
    const err = res.stderr ?? "";
    if (err.includes("NOT_FOUND")) {
      throw new Refusal(
        `Secret ${secret} doesn't exist in project ${project}. Ask an admin to create it ` +
          `(docs/db-migrations.md, "Deploying migrations").`,
      );
    }
    if (/PERMISSION_DENIED|403/.test(err)) {
      throw new Refusal(
        `Your gcloud login can't read secret ${secret} in project ${project}. ` +
          `Ask an admin for roles/secretmanager.secretAccessor on it.`,
      );
    }
    if (/reauth|login|credentials/i.test(err)) {
      throw new Refusal(
        "gcloud needs you to log in: run `gcloud auth login`, then try again.",
      );
    }
    throw new Refusal(
      `Couldn't read secret ${secret} in project ${project} with gcloud.`,
    );
  }
  const url = (res.stdout ?? "").trim();
  if (!url)
    throw new Refusal(`Secret ${secret} in project ${project} is empty.`);
  return url;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  return journal.entries.map((e) => ({ tag: e.tag, when: e.when }));
}

function connectionHint(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("ECONNREFUSED")) {
    return (
      "Nothing is listening at the address in the migration URL. If it " +
      "points at 127.0.0.1, start the Cloud SQL proxy first (docs/db-migrations.md)."
    );
  }
  if (msg.includes("password authentication failed")) {
    return "The database rejected the login in the migration URL. Ask an admin to check the secret.";
  }
  if (/timeout|ETIMEDOUT/i.test(msg)) {
    return "Couldn't reach the database (timed out). Is your IP allowed, or is the proxy running?";
  }
  return "Couldn't connect to the database.";
}

async function confirm(database: string, count: number): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = await rl.question(
      `\nType ${database} to apply ${count === 1 ? "this migration" : `these ${count} migrations`} to ${database} (anything else stops): `,
    );
    return confirmationMatches(typed, database);
  } finally {
    rl.close();
  }
}

export async function migrateRemote(target: RemoteEnvironment): Promise<void> {
  const env = ENVIRONMENTS[target];
  const { database } = env;

  // 1. A person, in a terminal.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Refusal(
      `Migrating ${database} asks you to confirm, so it must be run in a terminal, not a script or CI.`,
    );
  }

  // 2. Migrations from main only.
  const repoRoot = git(__dirname, [
    "rev-parse",
    "--show-toplevel",
  ]).stdout.trim();
  if (!repoRoot)
    throw new Refusal("Run this from a clone of F3-Nation/f3-nation.");
  const remote = findMainRemote(repoRoot);
  if (!remote) {
    throw new Refusal(
      "None of this clone's git remotes is github.com/F3-Nation/f3-nation, so there's no main to check against.",
    );
  }
  console.log(`Fetching ${remote}/main ...`);
  const fetched = git(repoRoot, ["fetch", "--quiet", remote, "main"]);
  if (fetched.status !== 0) {
    throw new Refusal(
      `git fetch ${remote} main failed, so this can't check your migrations against main: ${fetched.stderr.trim()}`,
    );
  }
  const gitRefusal = checkGitState(readGitState(repoRoot, `${remote}/main`));
  if (gitRefusal) throw new Refusal(gitRefusal);

  // 3. The URL names exactly this database (also the migrations table name).
  const url = migrationUrl(target);
  let tableDb: string | undefined;
  try {
    tableDb = migrationsDatabaseName(url);
  } catch (e) {
    throw new Refusal(
      `The migration URL is malformed: ${(e as Error).message}`,
    );
  }
  if (tableDb !== database) {
    throw new Refusal(
      `The migration URL must name database ${database} with no other URL parameters ` +
        `(they would rename the migrations table, and Drizzle would re-run every migration). ` +
        `It names "${tableDb ?? "?"}". Ask an admin to fix the secret.`,
    );
  }
  const migrationsTable = `__drizzle_migrations_${database}`;
  const { url: pgUrl, hostOptions } = postgresArgs(url);

  // 4. Read-only checks.
  const ro = postgres(pgUrl, {
    ...hostOptions,
    max: 1,
    connect_timeout: 15,
    onnotice: () => undefined,
    connection: {
      application_name: "f3-db-migrate (read-only checks)",
      default_transaction_read_only: true,
    },
  });
  let plan;
  try {
    let current: { db: string; user: string } | undefined;
    try {
      [current] = await ro<{ db: string; user: string }[]>`
        SELECT current_database() AS db, current_user AS "user"`;
    } catch (e) {
      throw new Refusal(connectionHint(e));
    }
    if (current?.db !== database) {
      throw new Refusal(
        `The migration URL connects to database "${current?.db}", not ${database}. Ask an admin to fix the secret.`,
      );
    }
    const [table] = await ro<{ present: boolean }[]>`
      SELECT to_regclass(${`drizzle.${migrationsTable}`}) IS NOT NULL AS present`;
    if (!table?.present) {
      throw new Refusal(
        `${database} has no drizzle.${migrationsTable}: this isn't the database it should be. Stop and ask in #dev.`,
      );
    }
    const [owner] = await ro<{ n: number; owners: string | null }[]>`
      SELECT count(*)::int AS n,
        string_agg(DISTINCT pg_get_userbyid(c.relowner), ', ') AS owners
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'auth', 'slackbot', 'drizzle')
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND NOT pg_has_role(current_user, c.relowner, 'USAGE')`;
    if ((owner?.n ?? 0) > 0) {
      throw new Refusal(
        `The migration login (${current.user}) doesn't own ${owner?.n} table(s) or other objects ` +
          `(owned by ${owner?.owners}), so migrations altering them would fail. The migration ` +
          `secret must use a login that owns the schema. Ask an admin.`,
      );
    }
    const rows = (
      await ro<{ created_at: string; hash: string }[]>`
        SELECT created_at::text AS created_at, hash
        FROM ${ro(`drizzle.${migrationsTable}`)}`
    ).map((r): AppliedRow => ({
      createdAt: Number(r.created_at),
      hash: r.hash,
    }));
    const fileHashes = new Map(
      readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR }).map((m) => [
        m.folderMillis,
        m.hash,
      ]),
    );
    plan = planMigrations(readJournal(), rows, fileHashes, env.knownSkipped);
  } finally {
    await ro.end();
  }

  for (const e of plan.hashMismatches) {
    console.log(
      `  note: ${e.tag} was edited after it ran on ${database} (hash differs); Drizzle ignores that.`,
    );
  }
  for (const e of plan.knownSkipped) {
    console.log(
      `  note: ${e.tag} is known never to have run on ${database}; Drizzle skips it.`,
    );
  }
  const planRefusal = checkPlan(plan, database);
  if (planRefusal) throw new Refusal(planRefusal);
  if (plan.pending.length === 0) {
    console.log(`\n${database} is up to date with main. Nothing to migrate.`);
    return;
  }

  // 5. Show and confirm.
  console.log(
    `\nPending migrations for ${database} (applied together, in one transaction):`,
  );
  for (const e of plan.pending) {
    console.log(
      `  ${e.tag}   (when ${e.when}, ${new Date(e.when).toISOString()})`,
    );
  }
  if (!(await confirm(database, plan.pending.length))) {
    console.log("Stopped. Nothing was changed.");
    return;
  }

  const rw = postgres(pgUrl, {
    ...hostOptions,
    max: 1,
    connect_timeout: 15,
    onnotice: () => undefined,
    connection: { application_name: "f3-db-migrate" },
  });
  try {
    console.log(`Migrating ${database} ...`);
    await migrator(drizzle(rw), {
      migrationsTable,
      migrationsFolder: MIGRATIONS_DIR,
    });
    const [after] = await rw<{ newest: string | null }[]>`
      SELECT max(created_at)::text AS newest FROM ${rw(`drizzle.${migrationsTable}`)}`;
    const expected = plan.pending[plan.pending.length - 1];
    if (Number(after?.newest) !== expected?.when) {
      throw new Error(
        `After migrating, ${database}'s newest migration is ${after?.newest}, expected ${expected?.when} (${expected?.tag}). Check it before doing anything else.`,
      );
    }
    console.log(`Done: ${database} is at ${expected.tag}.`);
  } finally {
    await rw.end();
  }
}

if (require.main === module) {
  const target = process.argv[2];
  if (target !== "staging" && target !== "prod") {
    console.error("usage: migrate-remote.ts staging|prod");
    process.exit(2);
  }
  migrateRemote(target)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      if (error instanceof Refusal) {
        console.error(`\nREFUSED: ${error.message}`);
        console.error("Nothing was changed.");
      } else {
        console.error(
          "\nMigration failed:",
          error instanceof Error ? error.message : error,
        );
      }
      process.exit(1);
    });
}
