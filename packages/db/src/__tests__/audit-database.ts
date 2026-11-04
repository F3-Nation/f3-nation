import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { LocalTargetAction } from "../migrate-guards";
import { assertLocalTarget, DISPOSABLE_MARKER } from "../migrate-guards";

const setupHelp =
  "Run pnpm local:setup with this checkout's configured slot, then use its TEST_DATABASE_URL in packages/db/.env. Setup regenerates env files with backups. Audit tests fail rather than skip an unsafe or missing target.";
const auditTestAction: LocalTargetAction = {
  verb: "create an audit-test database",
  variable: "TEST_DATABASE_URL",
  help: setupHelp,
};

/** Attempt all owned cleanup in dependency order, retaining earlier failures. */
export async function cleanupAuditResources(
  cleanups: (() => Promise<void>)[],
  errors: unknown[] = [],
): Promise<void> {
  const failures = [...errors];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Audit database setup or cleanup failed",
    );
}

/** Own a separate database so API global resets cannot remove these fixtures. */
export async function createAuditDatabase() {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured)
    throw new Error(`Audit tests require TEST_DATABASE_URL. ${setupHelp}`);
  await assertLocalTarget(configured, auditTestAction);
  const source = new URL(configured);
  const sourceName = source.pathname.slice(1);
  const probe = postgres(configured, { max: 1, onnotice: () => undefined });
  const probeErrors: unknown[] = [];
  try {
    const [live] = await probe<
      { name: string; marker: string | null }[]
    >`select current_database() as name,
      shobj_description(oid, 'pg_database') as marker
      from pg_database where datname = current_database()`;
    if (live?.name !== sourceName) {
      throw new Error(
        `Audit tests require a verified disposable test database: the live database does not match TEST_DATABASE_URL. ${setupHelp}`,
      );
    }
    if (!sourceName.endsWith("_test")) {
      throw new Error(
        `Audit tests require a verified disposable test database: TEST_DATABASE_URL must name a database ending in _test. ${setupHelp}`,
      );
    }
    // CI's exact test database is an ephemeral, job-owned PostgreSQL service.
    if (
      live.marker !== DISPOSABLE_MARKER &&
      !(process.env.CI === "true" && sourceName === "f3_test")
    ) {
      throw new Error(
        `Audit tests require a verified disposable test database: the disposable marker is missing or unrecognized. ${setupHelp}`,
      );
    }
  } catch (error) {
    probeErrors.push(error);
  }
  await cleanupAuditResources([() => probe.end()], probeErrors);

  const database = `f3_audit_${randomUUID().replaceAll("-", "")}_test`;
  source.pathname = "/postgres";
  const admin = postgres(source.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  let created = false;
  const cleanup = () =>
    cleanupAuditResources([
      async () => {
        if (created) {
          await admin`drop database ${admin(database)}`;
          created = false;
        }
      },
      () => admin.end(),
    ]);
  try {
    await admin`create database ${admin(database)}`;
    created = true;
    source.pathname = `/${database}`;
    const url = source.toString();
    const client = postgres(url, { max: 1, onnotice: () => undefined });
    const setupErrors: unknown[] = [];
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
    } catch (error) {
      setupErrors.push(error);
    }
    await cleanupAuditResources([() => client.end()], setupErrors);
    return { url, cleanup };
  } catch (error) {
    await cleanupAuditResources([cleanup], [error]);
    throw error;
  }
}
