/**
 * `pnpm -F @acme/db migrate:check`: apply this checkout's migrations the way
 * `pnpm db:migrate:prod` does, on a throwaway database shaped like prod, so a
 * migration that only fails there fails in CI instead.
 *
 * Plain CI migrates as the `postgres` superuser on a database with no views,
 * which hides two kinds of failure:
 *   - a statement that needs privileges the real migration login lacks;
 *   - dropping or changing a type or column that a view created outside the
 *     migrations depends on (docs/db-migrations.md, "Views created outside
 *     the migrations").
 *
 * On a disposable local server, given a superuser URL in
 * MIGRATE_CHECK_ADMIN_URL, it:
 *   1. recreates database f3_migrate_check and two plain (non-superuser)
 *      logins: OWNER, which owns the schema like the roles that ran earlier
 *      migrations, and MIGRATOR, a member of OWNER with CREATE on the
 *      database, the setup migrate-remote.ts requires (docs/db-migrations.md,
 *      "Database roles");
 *   2. applies the base commit's migrations (MIGRATE_CHECK_BASE, default
 *      <F3-Nation remote>/main) as OWNER;
 *   3. as the superuser, creates what prod-views.sql lists: the views staging
 *      and prod have that no migration creates. Views it creates are given to
 *      OWNER, as prod's belong to a role the migration login is a member of;
 *   4. as MIGRATOR, runs migrate-remote.ts's ownership check and journal
 *      plan, then this checkout's pending migrations with Drizzle's migrator,
 *      in one transaction.
 * A failure prints an `::error` annotation naming the migration file, line
 * and statement.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { AppliedRow, JournalEntry, MigrationPlan } from "./migrate-guards";
import { assertLocalTarget, planMigrations } from "./migrate-guards";
import {
  describeFailure,
  describeLoginGaps,
  findMainRemote,
  migrationLoginGaps,
} from "./migrate-remote";
import { postgresArgs } from "./utils/functions";

export const CHECK_DATABASE = "f3_migrate_check";
export const OWNER = "migrate_check_owner";
export const MIGRATOR = "migrate_check_migrator";
/** On the database's comment, so a rerun drops only a database this made. */
export const CHECK_MARKER = "f3-migrate-check-disposable";
const MIGRATIONS_TABLE = `__drizzle_migrations_${CHECK_DATABASE}`;

const PACKAGE_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PACKAGE_DIR, "drizzle");
const VIEWS_FIXTURE = path.join(PACKAGE_DIR, "prod-views.sql");

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

export interface MigrationFile {
  tag: string;
  /** The file's text, as Drizzle reads it. */
  content: string;
}

export interface FailedStatement {
  tag: string;
  /** 1-based line of the statement's first line of SQL (not a comment). */
  line: number;
  statement: string;
}

/**
 * The migration and line Drizzle's failed `query` came from. Drizzle runs
 * each `--> statement-breakpoint`-separated piece of a file verbatim, and its
 * error carries that piece, so an exact match finds it. Searched newest
 * first: the pending migrations are the newest.
 */
export function findFailedStatement(
  files: MigrationFile[],
  query: string,
): FailedStatement | undefined {
  for (const file of [...files].reverse()) {
    let offset = 0;
    for (const piece of file.content.split("--> statement-breakpoint")) {
      if (piece === query) {
        const lead = /^(\s|--[^\n]*)*/.exec(piece)?.[0] ?? "";
        const before = file.content.slice(0, offset) + lead;
        return {
          tag: file.tag,
          line: before.split("\n").length,
          statement: piece,
        };
      }
      offset += piece.length + "--> statement-breakpoint".length;
    }
  }
  return undefined;
}

/** A statement shortened for one annotation line, comments dropped. */
export function summarizeStatement(statement: string, max = 200): string {
  const text = statement
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()} ...` : text;
}

/**
 * A GitHub Actions workflow command (`::error file=…,line=…::message`),
 * escaped as the runner requires.
 */
export function workflowCommand(
  kind: "error" | "warning",
  message: string,
  props: Record<string, string | number> = {},
): string {
  const escapeData = (s: string) =>
    s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProp = (s: string) =>
    escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const list = Object.entries(props)
    .map(([k, v]) => `${k}=${escapeProp(String(v))}`)
    .join(",");
  return `::${kind}${list ? ` ${list}` : ""}::${escapeData(message)}`;
}

/**
 * What the journal plan means for a branch, compared with the base's applied
 * migrations: errors for what prod's deploy would refuse or silently skip,
 * warnings for what it ignores.
 */
export function planProblems(plan: MigrationPlan): {
  errors: string[];
  warnings: string[];
} {
  return {
    errors: [
      ...plan.unknownRows.map(
        (r) =>
          `The base applied a migration (when ${r.createdAt}) that this branch's journal no longer has. Never remove or renumber a migration main already has.`,
      ),
      ...plan.skipped.map(
        (e) =>
          `${e.tag}: its journal "when" (${e.when}) is older than the newest migration on the base, so Drizzle would skip it forever in staging and prod. Regenerate it on top of main (db-migration skill, step 7).`,
      ),
    ],
    warnings: plan.hashMismatches.map(
      (e) =>
        `${e.tag} differs from the base's copy. Staging and prod already ran the base's version and never run an edited migration again.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** A failure already reported in full: only its message is printed again. */
export class Reported extends Error {}

/**
 * An annotation in GitHub Actions; elsewhere the same line, which still
 * reads as file, line and message.
 */
function report(
  kind: "error" | "warning",
  message: string,
  props: Record<string, string | number> = {},
) {
  console.log(workflowCommand(kind, message, props));
}

function git(cwd: string, args: string[]) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  }
  return res.stdout;
}

/**
 * The base commit's migrations (journal and .sql files: what Drizzle reads),
 * copied into a temporary folder.
 */
function extractBaseMigrations(repoRoot: string, ref: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "f3-migrate-check-"));
  mkdirSync(path.join(dir, "meta"));
  const files = git(repoRoot, [
    "ls-tree",
    "--name-only",
    `${ref}:packages/db/drizzle`,
  ])
    .split("\n")
    .filter((f) => f.endsWith(".sql"));
  for (const f of [...files, "meta/_journal.json"]) {
    writeFileSync(
      path.join(dir, f),
      git(repoRoot, ["show", `${ref}:packages/db/drizzle/${f}`]),
    );
  }
  return dir;
}

function readFiles(folder: string): {
  journal: JournalEntry[];
  files: MigrationFile[];
} {
  const journal = (
    JSON.parse(
      readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
    ) as {
      entries: JournalEntry[];
    }
  ).entries.map((e) => ({ tag: e.tag, when: e.when }));
  return {
    journal,
    files: journal.map((e) => ({
      tag: e.tag,
      content: readFileSync(path.join(folder, `${e.tag}.sql`), "utf8"),
    })),
  };
}

/** A URL for the check database as `user`, on the admin URL's server. */
function loginUrl(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  url.pathname = `/${CHECK_DATABASE}`;
  return url.toString();
}

function connect(url: string, name: string) {
  const { url: pgUrl, hostOptions } = postgresArgs(url);
  return postgres(pgUrl, {
    ...hostOptions,
    max: 1,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: `f3-migrate-check (${name})` },
  });
}

/**
 * Drizzle's migrator over `folder`, as production runs it. On failure, report
 * the migration, line and statement, then rethrow.
 */
async function applyAs(
  url: string,
  login: string,
  folder: string,
  files: MigrationFile[],
  annotatePath: (tag: string) => string,
) {
  const client = connect(url, login);
  try {
    await migrator(drizzle(client), {
      migrationsTable: MIGRATIONS_TABLE,
      migrationsFolder: folder,
    });
  } catch (e) {
    const query = (e as { query?: unknown }).query;
    const cause = (e as { cause?: unknown }).cause;
    const pg = (cause ?? e) as {
      message?: string;
      code?: string;
      detail?: string;
    };
    const found =
      typeof query === "string" ? findFailedStatement(files, query) : undefined;
    const why =
      `${pg.message ?? String(e)}${pg.code ? ` [${pg.code}]` : ""}` +
      (pg.detail ? `. ${pg.detail}` : "");
    if (found) {
      report(
        "error",
        `${found.tag} fails as ${login}, a non-superuser login set up like production's: ${why}\nStatement: ${summarizeStatement(found.statement)}`,
        {
          file: annotatePath(found.tag),
          line: found.line,
          title: `Migration ${found.tag} fails in a production-shaped database`,
        },
      );
    } else {
      report("error", `Migrating as ${login} failed: ${why}`);
    }
    // describeFailure's first line is about a deploy; the rest is the cause.
    for (const line of describeFailure(e).slice(1)) console.error(line);
    throw new Reported(`Migrating as ${login} failed.`);
  } finally {
    await client.end();
  }
}

async function setUp(adminUrl: string) {
  const admin = connect(adminUrl, "setup");
  const passwords = {
    [OWNER]: randomBytes(18).toString("hex"),
    [MIGRATOR]: randomBytes(18).toString("hex"),
  };
  try {
    const [existing] = await admin<{ comment: string | null }[]>`
      SELECT shobj_description(oid, 'pg_database') AS comment
      FROM pg_database WHERE datname = ${CHECK_DATABASE}`;
    if (existing) {
      if (existing.comment !== CHECK_MARKER) {
        throw new Error(
          `Database ${CHECK_DATABASE} exists but wasn't made by this check (no ${CHECK_MARKER} comment); refusing to drop it.`,
        );
      }
      await admin.unsafe(`DROP DATABASE ${CHECK_DATABASE} WITH (FORCE)`);
    }
    for (const role of [OWNER, MIGRATOR] as const) {
      const [found] =
        await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
      await admin.unsafe(
        `${found ? "ALTER" : "CREATE"} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords[role]}'`,
      );
    }
    await admin.unsafe(`GRANT ${OWNER} TO ${MIGRATOR}`);
    await admin.unsafe(`CREATE DATABASE ${CHECK_DATABASE}`);
    await admin.unsafe(
      `COMMENT ON DATABASE ${CHECK_DATABASE} IS '${CHECK_MARKER}'`,
    );
    // Both may create schemas (the migrations create auth, slackbot, audit).
    await admin.unsafe(
      `GRANT CREATE ON DATABASE ${CHECK_DATABASE} TO ${OWNER}, ${MIGRATOR}`,
    );
  } finally {
    await admin.end();
  }
  const superuserUrl = new URL(adminUrl);
  superuserUrl.pathname = `/${CHECK_DATABASE}`;
  const superuser = connect(superuserUrl.toString(), "setup");
  try {
    // public stays pg_database_owner's, as on Cloud SQL; the schema owner
    // gets what migrations need in it.
    await superuser.unsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${OWNER}`);
  } finally {
    await superuser.end();
  }
  return {
    superuserUrl: superuserUrl.toString(),
    ownerUrl: loginUrl(adminUrl, OWNER, passwords[OWNER]),
    migratorUrl: loginUrl(adminUrl, MIGRATOR, passwords[MIGRATOR]),
  };
}

/** Create the fixture's objects, then give its views to the schema owner. */
async function createProdViews(superuserUrl: string, fixture: string) {
  const db = connect(superuserUrl, "prod views");
  try {
    await db.unsafe(readFileSync(fixture, "utf8"));
    await db.unsafe(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT c.oid::regclass AS rel, c.relkind FROM pg_class c
          WHERE c.relkind IN ('v', 'm') AND c.relowner = current_user::regrole
            AND c.relnamespace::regnamespace::text NOT IN ('pg_catalog', 'information_schema')
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
              AND d.objid = c.oid AND d.deptype = 'e')
        LOOP
          EXECUTE format('ALTER %s %s OWNER TO ${OWNER}',
            CASE r.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END, r.rel);
        END LOOP;
      END $$`);
  } finally {
    await db.end();
  }
}

export interface MigrateCheckOptions {
  /** A superuser on a disposable local server. */
  adminUrl: string;
  /** The commit whose migrations are applied first; default <remote>/main. */
  base?: string;
  /** This checkout's migrations; tests pass a copy. */
  migrationsDir?: string;
  /** The views to create; tests pass their own. */
  viewsFixture?: string;
}

export async function migrateCheck({
  adminUrl,
  base: baseRef,
  migrationsDir = MIGRATIONS_DIR,
  viewsFixture = VIEWS_FIXTURE,
}: MigrateCheckOptions): Promise<void> {
  await assertLocalTarget(adminUrl, {
    verb: "run the migration check",
    help: "It creates roles and a database, so it only runs against a disposable local server.",
  });
  const repoRoot = git(__dirname, ["rev-parse", "--show-toplevel"]).trim();
  let base = baseRef;
  if (!base) {
    const remote = findMainRemote(repoRoot);
    if (!remote) {
      throw new Error(
        "No git remote fetches github.com/F3-Nation/f3-nation; set MIGRATE_CHECK_BASE to the commit to compare with.",
      );
    }
    base = `${remote}/main`;
  }
  const baseSha = git(repoRoot, [
    "rev-parse",
    "--verify",
    `${base}^{commit}`,
  ]).trim();

  const baseDir = extractBaseMigrations(repoRoot, baseSha);
  try {
    const baseFiles = readFiles(baseDir);
    const branch = readFiles(migrationsDir);
    const relative = path.relative(repoRoot, migrationsDir);
    const { superuserUrl, ownerUrl, migratorUrl } = await setUp(adminUrl);

    console.log(
      `Applying the base's ${baseFiles.journal.length} migrations (${base}, ${baseSha.slice(0, 12)}) as ${OWNER} ...`,
    );
    await applyAs(ownerUrl, OWNER, baseDir, baseFiles.files, (tag) =>
      path.join(relative, `${tag}.sql`),
    );

    console.log(
      `Creating the views staging and prod have (${path.relative(repoRoot, viewsFixture)}) ...`,
    );
    await createProdViews(superuserUrl, viewsFixture);

    const mig = connect(migratorUrl, MIGRATOR);
    let plan: MigrationPlan;
    try {
      const refusal = describeLoginGaps(
        MIGRATOR,
        await migrationLoginGaps(mig),
      );
      if (refusal) {
        report(
          "error",
          `${refusal}. The check's role setup no longer matches production's.`,
        );
        throw new Reported(refusal);
      }
      const rows = (
        await mig<{ created_at: string; hash: string }[]>`
          SELECT created_at::text AS created_at, hash
          FROM ${mig(`drizzle.${MIGRATIONS_TABLE}`)}`
      ).map((r): AppliedRow => ({
        createdAt: Number(r.created_at),
        hash: r.hash,
      }));
      const hashes = new Map(
        readMigrationFiles({ migrationsFolder: migrationsDir }).map((m) => [
          m.folderMillis,
          m.hash,
        ]),
      );
      plan = planMigrations(branch.journal, rows, hashes, []);
    } finally {
      await mig.end();
    }
    const problems = planProblems(plan);
    for (const w of problems.warnings) report("warning", w);
    for (const e of problems.errors) report("error", e);
    if (problems.errors.length > 0) {
      throw new Reported(
        "The branch's journal doesn't apply on top of the base's.",
      );
    }

    if (plan.pending.length === 0) {
      console.log("No migrations beyond the base's: nothing more to apply.");
    } else {
      console.log(
        `Applying ${plan.pending.map((e) => e.tag).join(", ")} as ${MIGRATOR}, in one transaction ...`,
      );
      await applyAs(migratorUrl, MIGRATOR, migrationsDir, branch.files, (tag) =>
        path.join(relative, `${tag}.sql`),
      );
    }
    console.log("Every migration applies in a production-shaped database.");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const adminUrl = process.env.MIGRATE_CHECK_ADMIN_URL;
  if (!adminUrl) {
    console.error(
      "Set MIGRATE_CHECK_ADMIN_URL to a superuser URL for a disposable local Postgres (e.g. postgres://postgres:postgres@localhost:5432/postgres).",
    );
    process.exit(2);
  }
  migrateCheck({ adminUrl, base: process.env.MIGRATE_CHECK_BASE })
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      if (error instanceof Reported) {
        console.error(`\nMigration check failed: ${error.message}`);
      } else {
        console.error("\nMigration check failed.");
        for (const line of describeFailure(error).slice(1)) console.error(line);
      }
      process.exit(1);
    });
}
