/**
 * Shared CLI + connection guard for the scripts that run against staging
 * itself around a refresh load (staging-api-keys.ts, staging-slack.ts).
 *
 * Refuses unless --allow-db names the exact database, DATABASE_URL and the
 * server both agree on that name, and the name doesn't look like production.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

export function flagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

/** Every value of a repeatable flag: `--keep a --keep b` or `--keep=a`. */
export function flagValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
    else if (arg === name && argv[i + 1] !== undefined)
      values.push(argv[i + 1]!);
  });
  return values;
}

/** "stash" or "restore", from exactly one of --stash / --restore. */
export function stashOrRestore(argv: string[]): "stash" | "restore" {
  const stash = argv.includes("--stash");
  const restore = argv.includes("--restore");
  if (stash === restore) {
    throw new Error("Pass exactly one of --stash or --restore.");
  }
  return stash ? "stash" : "restore";
}

export async function connectToStaging(argv: string[]): Promise<postgres.Sql> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const allowDb = flagValue(argv, "--allow-db");
  if (!allowDb) {
    throw new Error(
      "Refusing to run: pass --allow-db <name> naming the exact database.",
    );
  }
  if (databaseNameFromUrl(databaseUrl) !== allowDb) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not point at "${allowDb}".`,
    );
  }
  if (looksLikeProdDbName(allowDb)) {
    throw new Error(
      `Refusing to run: database name "${allowDb}" is (or looks like) production.`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const [current] = await sql<{ db: string }[]>`
    SELECT current_database() AS db`;
  if (current?.db !== allowDb) {
    await sql.end();
    throw new Error(
      `Refusing to run: connected database is "${current?.db}" but --allow-db is "${allowDb}".`,
    );
  }
  return sql;
}
