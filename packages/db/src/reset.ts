import { fileURLToPath } from "url";

import { sql } from "drizzle-orm/sql";

import { isTest } from "@acme/shared/common/constants";

import { alembicVersion } from "../drizzle/schema";
import { getDb, getDbUrl } from "./utils/functions";

interface DbUser extends Record<string, unknown> {
  rolname: string;
}

export let alembicVersionValue: string | undefined;

export const reset = async () => {
  const { databaseUrl, databaseName } = getDbUrl();
  const db = getDb();
  if (!databaseUrl) return;
  if (process.env.CI && !isTest) return;

  const isTestDB = databaseName?.endsWith("_test");

  process.stdout.write(
    `Resetting database ${databaseUrl} ${isTest ? "(TEST)" : ""} ARE YOU SURE? (y/n): `,
  );
  // wait for confirmation from the command line
  if (isTest && isTestDB) {
    console.log("Bypassing confirmation for test database");
  } else {
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
    const [result] = await db.select().from(alembicVersion);
    version_num = result?.versionNum;
    console.log("Alembic version", version_num);
  } catch (e) {
    console.log("Alembic version not found");
  }

  // Get all non-system users before dropping the schema
  const users = await db.execute<DbUser>(sql`
    SELECT rolname FROM pg_roles 
    WHERE rolname NOT IN ('postgres', 'azure_pg_admin', 'azure_superuser', 'cloudsqlsuperuser')
  `);

  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);

  for (const user of users) {
    const quotedRolname = `"${user.rolname}"`;
    await db.execute(sql`
      GRANT USAGE ON SCHEMA public TO ${sql.raw(quotedRolname)};
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${sql.raw(quotedRolname)};
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(quotedRolname)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${sql.raw(quotedRolname)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${sql.raw(quotedRolname)};
    `);
  }

  return;
};

// ESM equivalent of `if (require.main === module)`
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  void reset()
    .then(() => console.log("Reset done"))
    .catch((e) => {
      console.log("Reset failed", e);
    })
    .finally(() => {
      process.exit();
    });
}
