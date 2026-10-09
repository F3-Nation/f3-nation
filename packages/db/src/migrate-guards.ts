/**
 * Guards for running migrations (decision logic only, no I/O, so each
 * refusal is unit-tested). Used by migrate.ts (`pnpm db:migrate:local`) and
 * by migrate-remote.ts (`pnpm db:migrate:staging` / `pnpm db:migrate:prod`).
 *
 * Why: on 2026-10-08 `pnpm db:migrate` (since removed) was run from an unmerged branch with a
 * production DATABASE_URL in packages/db/.env, and applied that branch's
 * migrations to prod. Staging and prod now migrate only through the remote
 * commands, only from migrations that are on main, and only after these
 * checks; the local command refuses anything that isn't a local database.
 */

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export type RemoteEnvironment = "staging" | "prod";

export interface EnvironmentConfig {
  /** Exact server-reported current_database(). */
  database: string;
  /** Secret Manager secret holding the migration login's URL. */
  secret: string;
  /**
   * Journal entries this database is known not to have, although newer ones
   * are applied. Drizzle never runs those (it only runs entries newer than
   * the newest applied one), so anything else in that state is refused.
   */
  knownSkipped: string[];
}

/** Secret Manager project the migration URLs live in, unless overridden. */
export const DEFAULT_SECRET_PROJECT = "f3data";

export const ENVIRONMENTS: Record<RemoteEnvironment, EnvironmentConfig> = {
  staging: {
    database: "f3_staging",
    secret: "MIGRATE_DATABASE_URL_STAGING",
    knownSkipped: [],
  },
  prod: {
    database: "f3_prod",
    secret: "MIGRATE_DATABASE_URL_PROD",
    // 0008_nice_leech was applied to staging but never to prod, and prod had
    // already moved past its timestamp, so Drizzle can never apply it there
    // (checked read-only 2026-10-08: prod lacks only this one).
    knownSkipped: ["0008_nice_leech"],
  },
};

// ---------------------------------------------------------------------------
// Local vs remote
// ---------------------------------------------------------------------------

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Where a database URL points, from the URL alone. A Unix socket counts as
 * local unless it is a Cloud SQL socket (`/cloudsql/...`). This can't see
 * through a cloud-sql-proxy on localhost, so migrate.ts also asks the server
 * (see assertLocalTarget in migrate.ts).
 */
export function classifyHost(databaseUrl: string): "local" | "remote" {
  const socketHosts = queryHosts(databaseUrl);
  // Several host= values (e.g. a socket and a TCP host): clients disagree on
  // which wins, so never call that local.
  if (socketHosts.length > 1) return "remote";
  // The last socket host= wins, as in splitSocketHost.
  const socket = [...socketHosts].reverse().find((h) => h.startsWith("/"));
  if (socket !== undefined) {
    return socket.toLowerCase().includes("/cloudsql") ? "remote" : "local";
  }
  if (socketHosts.length > 0) return "remote"; // a TCP host= overrides the URL's
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Unparseable with no socket (e.g. an empty host): never assume local.
    return "remote";
  }
  return LOCAL_HOSTNAMES.has(url.hostname.toLowerCase()) ? "local" : "remote";
}

/**
 * Every `host=` query value, decoded. Read from the raw query so URLs the URL
 * parser rejects (`user:pass@/db?host=/var/run/postgresql`, which libpq and
 * postgresArgs accept) are classified too.
 */
function queryHosts(databaseUrl: string): string[] {
  const q = databaseUrl.indexOf("?");
  if (q < 0) return [];
  return databaseUrl
    .slice(q + 1)
    .split("&")
    .map((pair) => pair.split("="))
    .filter(([k]) => safeDecode(k ?? "") === "host")
    .map(([, v]) => safeDecode(v ?? ""));
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return part;
  }
}

/**
 * The same URL pointed at the maintenance database `postgres`: only the last
 * path segment before the query changes (a user name equal to the database
 * name, or an empty host, are left alone).
 */
export function maintenanceUrl(databaseUrl: string): string {
  return databaseUrl.replace(/^([^?]*\/)[^/?]*(\?|$)/, "$1postgres$2");
}

/**
 * Whether a git remote URL is github.com/F3-Nation/f3-nation, over HTTPS or
 * SSH. Nothing else (another host, a local path, a lookalike) counts as main.
 */
export function isMainRepoUrl(remoteUrl: string): boolean {
  const scp = /^git@github\.com:(.+)$/i.exec(remoteUrl);
  let repoPath: string;
  if (scp?.[1]) {
    repoPath = scp[1];
  } else {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      return false;
    }
    if (!["https:", "ssh:"].includes(url.protocol)) return false;
    if (url.hostname.toLowerCase() !== "github.com") return false;
    if (url.port !== "") return false;
    repoPath = url.pathname.replace(/^\//, "");
  }
  return /^f3-nation\/f3-nation(?:\.git)?\/?$/i.test(repoPath);
}

/** Databases the local command never touches, whatever the host. */
export function isProtectedDatabaseName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    Object.values(ENVIRONMENTS).some((e) => e.database === n) ||
    /(?:^|[-_])(prod|production|staging)(?:$|[-_])/.test(n)
  );
}

// ---------------------------------------------------------------------------
// Git: migrations must come from main
// ---------------------------------------------------------------------------

export interface GitState {
  /** packages/db/drizzle in the working tree differs from origin/main. */
  differsFromMain: boolean;
  /** Changed (staged or not) or untracked files under packages/db/drizzle. */
  localChanges: string[];
  /** HEAD is an ancestor of (or equal to) origin/main. */
  headOnMain: boolean;
}

/**
 * null when the checkout's migrations may be applied, else why not.
 *
 * Allowed: packages/db/drizzle is exactly origin/main's, or HEAD is a commit
 * on main (the release process checks out a release commit, which may be
 * behind main) with no local changes under packages/db/drizzle. Never from
 * a branch whose migrations differ from main's: that is how 2026-10-08
 * happened.
 */
export function checkGitState(state: GitState): string | null {
  if (state.localChanges.length > 0) {
    return (
      `You have uncommitted or untracked changes in packages/db/drizzle:\n` +
      state.localChanges.map((f) => `  ${f}`).join("\n") +
      `\nStaging and prod are only migrated from main. Commit and merge them ` +
      `through a pull request first, or discard them.`
    );
  }
  if (state.differsFromMain && !state.headOnMain) {
    return (
      `This checkout's migrations (packages/db/drizzle) are not main's. ` +
      `Staging and prod are only migrated from main, after the pull request ` +
      `is merged. Run: git switch main && git pull, then try again.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Journal vs database
// ---------------------------------------------------------------------------

/** packages/db/drizzle/meta/_journal.json entry. */
export interface JournalEntry {
  tag: string;
  when: number;
}

/** A row of drizzle.__drizzle_migrations_<db>. */
export interface AppliedRow {
  createdAt: number;
  hash: string;
}

export interface MigrationPlan {
  /** Will be applied, oldest first. */
  pending: JournalEntry[];
  /** Fatal: rows whose created_at no journal entry has. */
  unknownRows: AppliedRow[];
  /** Fatal: missing entries Drizzle would silently skip. */
  skipped: JournalEntry[];
  /** Warnings only: missing entries known to be skipped on this database. */
  knownSkipped: JournalEntry[];
  /** Warnings only: applied, but the file changed since (hash differs). */
  hashMismatches: JournalEntry[];
}

/**
 * Drizzle's migrator applies, in one transaction, every journal entry whose
 * `when` is newer than the newest applied `created_at`, and checks nothing
 * else. So, comparing the database's rows with this checkout's journal:
 *
 * - a row the journal has no entry for is fatal. It is migrations this code
 *   doesn't know: someone applied unmerged ones (the 2026-10-08 signature:
 *   newer than main's newest), or this checkout is older than what is
 *   deployed. Either way, stop and ask.
 * - an entry the database lacks with a `when` at or before the newest applied
 *   row would be skipped silently, forever: fatal, unless listed in the
 *   environment's knownSkipped.
 * - a row whose hash differs from the file's is only a warning: files were
 *   edited after they ran (prod's 0011 and 0015), and Drizzle never reads
 *   the hash.
 */
export function planMigrations(
  journal: JournalEntry[],
  rows: AppliedRow[],
  /** sha256 of each migration file, by journal `when` (as Drizzle hashes). */
  fileHashes: Map<number, string>,
  knownSkipped: string[],
): MigrationPlan {
  const byWhen = new Map(journal.map((e) => [e.when, e]));
  const applied = new Map(rows.map((r) => [r.createdAt, r]));
  const newest = rows.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const plan: MigrationPlan = {
    pending: [],
    unknownRows: rows.filter((r) => !byWhen.has(r.createdAt)),
    skipped: [],
    knownSkipped: [],
    hashMismatches: [],
  };
  for (const entry of [...journal].sort((a, b) => a.when - b.when)) {
    const row = applied.get(entry.when);
    if (row) {
      const fileHash = fileHashes.get(entry.when);
      if (fileHash !== undefined && fileHash !== row.hash) {
        plan.hashMismatches.push(entry);
      }
    } else if (entry.when > newest) {
      plan.pending.push(entry);
    } else if (knownSkipped.includes(entry.tag)) {
      plan.knownSkipped.push(entry);
    } else {
      plan.skipped.push(entry);
    }
  }
  return plan;
}

/** The refusal for a plan, or null when it may run. */
export function checkPlan(
  plan: MigrationPlan,
  database: string,
): string | null {
  if (plan.unknownRows.length > 0) {
    return (
      `${database} has ${plan.unknownRows.length} migration(s) this checkout ` +
      `doesn't know about (created_at ${plan.unknownRows
        .map((r) => r.createdAt)
        .join(
          ", ",
        )}). Either someone applied migrations that aren't on main, ` +
      `or your checkout is older than what is deployed. Stop and ask in ` +
      `#monorepo before migrating.`
    );
  }
  if (plan.skipped.length > 0) {
    return (
      `${plan.skipped.map((e) => e.tag).join(", ")} ${plan.skipped.length === 1 ? "is" : "are"} ` +
      `not applied to ${database}, but newer migrations are, so Drizzle would ` +
      `silently skip ${plan.skipped.length === 1 ? "it" : "them"} forever. A ` +
      `migration's journal "when" must be newer than every migration already ` +
      `applied. Stop and ask in #monorepo.`
    );
  }
  return null;
}

/** Whether the typed confirmation names the target database exactly. */
export function confirmationMatches(typed: string, database: string): boolean {
  return typed.trim() === database;
}
