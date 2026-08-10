import { sql } from "drizzle-orm/sql";

import { isTest } from "@acme/shared/common/constants";

import type { AppDb } from "./client";
import { alembicVersion } from "../drizzle/schema";
import { getDb, getDbUrl } from "./utils/functions";

interface DbUser extends Record<string, unknown> {
  rolname: string;
}

export let alembicVersionValue: string | undefined;

export const reset = async (db?: AppDb) => {
  const { databaseUrl, databaseName } = getDbUrl();
  const dbToUse = db ?? getDb();
  if (!databaseUrl) return;
  if (process.env.CI && !isTest) return;

  const isTestDB = databaseName?.endsWith("_test");

  // wait for confirmation from the command line
  if (isTest) {
    // A caller-supplied `db` can be connected to a different database than
    // TEST_DATABASE_URL describes, so trusting `databaseName` (parsed from
    // the URL, not the live connection) isn't enough before destructive
    // schema operations run against `dbToUse`. Confirm the client we're
    // actually about to drop schemas on is itself a "_test" database.
    const [connectedDb] = await dbToUse.execute<{
      current_database: string;
    }>(sql`SELECT current_database()`);
    const connectedDbName = connectedDb?.current_database;

    if (!isTestDB || !connectedDbName?.endsWith("_test")) {
      // Automated/non-interactive callers (e.g. Vitest globalSetup) only
      // ever intend to reset a "_test" database. Falling through to the
      // stdin prompt below would hang forever with no TTY to answer it.
      throw new Error(
        `Refusing to reset "${connectedDbName ?? databaseName}": NODE_ENV=test requires a database name ending in "_test" (check TEST_DATABASE_URL).`,
      );
    }
    console.log("Bypassing confirmation for test database");
  } else {
    // Only printed for the interactive path: the full URL can carry
    // credentials, and the automated (isTest) branches above never read
    // this prompt, so it must not run unconditionally on every reset.
    process.stdout.write(
      `Resetting database ${databaseUrl} ARE YOU SURE? (y/n): `,
    );
    const confirmation = await new Promise((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });
    if (confirmation !== "y") {
      throw new Error("Reset cancelled");
    }
  }

  // We need to manually handle the alembic version table for moneyball's work
  let version_num: string | undefined;
  try {
    const [result] = await dbToUse.select().from(alembicVersion);
    version_num = result?.versionNum;
    console.log("Alembic version", version_num);
  } catch {
    console.log("Alembic version not found");
  }

  // Get all non-system users before dropping the schema
  const users = await dbToUse.execute<DbUser>(sql`
    SELECT rolname FROM pg_roles
    WHERE rolname NOT IN ('postgres', 'azure_pg_admin', 'azure_superuser', 'cloudsqlsuperuser')
  `);

  await dbToUse.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await dbToUse.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await dbToUse.execute(sql`DROP SCHEMA IF EXISTS auth CASCADE`);
  await dbToUse.execute(sql`CREATE SCHEMA public`);

  for (const user of users) {
    const quotedRolname = `"${user.rolname}"`;
    await dbToUse.execute(sql`
      GRANT USAGE ON SCHEMA public TO ${sql.raw(quotedRolname)};
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${sql.raw(quotedRolname)};
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(quotedRolname)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${sql.raw(quotedRolname)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${sql.raw(quotedRolname)};
    `);
  }

  return;
};

if (require.main === module) {
  void reset()
    .then(() => console.log("Reset done"))
    .catch((e) => {
      console.log("Reset failed", e);
    })
    .finally(() => {
      process.exit();
    });
}
