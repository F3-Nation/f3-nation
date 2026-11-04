import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { assertLocalTarget, DISPOSABLE_MARKER } from "../migrate-guards";

/** Own a separate database so API global resets cannot remove these fixtures. */
export async function createAuditDatabase() {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured) throw new Error("Audit tests require TEST_DATABASE_URL");
  await assertLocalTarget(configured);
  const source = new URL(configured);
  const sourceName = source.pathname.slice(1);
  const probe = postgres(configured, { max: 1, onnotice: () => undefined });
  try {
    const [live] = await probe<
      { name: string; marker: string | null }[]
    >`select current_database() as name,
      shobj_description(oid, 'pg_database') as marker
      from pg_database where datname = current_database()`;
    if (
      live?.name !== sourceName ||
      !sourceName.endsWith("_test") ||
      (live.marker !== DISPOSABLE_MARKER &&
        !(process.env.CI && sourceName === "f3_test"))
    ) {
      throw new Error(
        "Audit tests require a verified disposable test database",
      );
    }
  } finally {
    await probe.end();
  }

  const database = `f3_audit_${randomUUID().replaceAll("-", "")}_test`;
  source.pathname = "/postgres";
  const admin = postgres(source.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  let created = false;
  const cleanup = async () => {
    try {
      if (created) {
        await admin`drop database ${admin(database)}`;
        created = false;
      }
    } finally {
      await admin.end();
    }
  };
  try {
    await admin`create database ${admin(database)}`;
    created = true;
    source.pathname = `/${database}`;
    const url = source.toString();
    const client = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      const [live] = await client<
        { name: string }[]
      >`select current_database() as name`;
      if (live?.name !== database)
        throw new Error("Audit test database target mismatch");
      await migrate(drizzle(client), {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url),
        ),
      });
    } finally {
      await client.end();
    }
    return { url, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
