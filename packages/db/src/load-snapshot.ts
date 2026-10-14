/**
 * `pnpm db:load:snapshot [--url <https url> | --file <snapshot.tar>] [--yes]`:
 * load the sanitized Prod snapshot into the local Docker database. See
 * load-snapshot-lib.ts for the flow and its guards.
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { env } from "@acme/env";

import { db } from "./client";
import { logError } from "./lib/logging";
import {
  LOAD_SNAPSHOT_ACTION,
  createLoadDb,
  parseArgs,
  runLoad,
} from "./load-snapshot-lib";
import {
  confirm,
  fetchToFile,
  mkTmp,
  readText,
  rmTmp,
  runProc,
} from "./load-snapshot-io";
import { DEV_LOGIN_HINT } from "./local-seed-lib/data";
import {
  seedApiKeys,
  seedDevUsers,
  seedOAuthClients,
} from "./local-seed-lib/users";
import { assertLocalTarget } from "./migrate-guards";
import { getDbUrl, migrationsDatabaseName } from "./utils/functions";

async function main() {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const clientUrl = getDbUrl().databaseUrl;

  const args = parseArgs(process.argv.slice(2));
  // pnpm runs this from packages/db and the nested `pnpm with-env` resets
  // INIT_CWD, so the script captures where the user ran it first.
  if (args.file) {
    const from =
      process.env.SNAPSHOT_CALLER_CWD ?? process.env.INIT_CWD ?? process.cwd();
    args.file = path.resolve(from, args.file);
  }

  const result = await runLoad(args, {
    now: () => new Date(),
    clock: () => performance.now(),
    isCI: Boolean(process.env.CI),
    isTTY: Boolean(process.stdin.isTTY),
    databaseUrl,
    targetUrls: [...new Set([databaseUrl, clientUrl])],
    assertLocal: (url) => assertLocalTarget(url, LOAD_SNAPSHOT_ACTION),
    mkTmp,
    rmTmp,
    fetchToFile,
    copyFile,
    readText,
    tar: (args) => runProc("tar", args),
    docker: (args, stdinFile) => runProc("docker", args, stdinFile),
    confirm,
    db: createLoadDb(
      db,
      `__drizzle_migrations_${migrationsDatabaseName(databaseUrl) ?? ""}`,
    ),
    seeders: {
      seedDevUsers: (nationId) => seedDevUsers(db, nationId),
      seedApiKeys: (adminUserId, nationId, roleIds, regionIds) =>
        seedApiKeys(db, adminUserId, nationId, roleIds, regionIds, {
          skipMissingRegions: true,
        }),
      seedOAuthClients: () => seedOAuthClients(db),
    },
  });

  const seconds = (result.elapsedMs / 1000).toFixed(1);
  process.stdout.write(
    `\nSnapshot loaded: ${result.tables} tables, ${result.rows} rows in ${seconds}s.\n${DEV_LOGIN_HINT}\n`,
  );
}

void main()
  .catch((err: unknown) => {
    logError("db.snapshot.failed", {}, err);
    process.stderr.write(
      `\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
