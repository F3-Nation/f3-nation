// Provision an ISOLATED test database for the redirect web integration tests.
//
// In CI the shared Postgres service exposes a single `f3_test` database that
// `@acme/db` owns and resets (dropping/recreating its schema). Our auth/domain
// tables would be clobbered by that reset, so we carve out our own database
// (`f3redirect_test`) on the same server and push our Drizzle schema into it.
// vitest.config.ts derives the same dedicated URL, so tests and this reset
// always agree — and never collide with @acme/db.
import { execSync } from "node:child_process";
import postgres from "postgres";

const DEDICATED_DB = "f3redirect_test";
const base =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://f3local:f3local@localhost:5433/f3nation";

function withPath(urlStr, dbName) {
  const u = new URL(urlStr);
  u.pathname = "/" + dbName;
  return u.toString();
}

// 1) Reset the dedicated database (connect via the server's default `postgres`
//    database; CREATE/DROP DATABASE can't run in a tx). This is the advertised
//    reset entrypoint, so drop-and-recreate when it exists rather than leaving
//    rows behind — `drizzle-kit push --force` only reconciles schema, not data,
//    so a create-if-missing would make the integration suite stateful across
//    runs.
const admin = postgres(withPath(base, "postgres"), { max: 1 });
try {
  const exists =
    await admin`SELECT 1 FROM pg_database WHERE datname = ${DEDICATED_DB}`;
  if (exists.length !== 0) {
    // Terminate other connections so DROP DATABASE doesn't block.
    await admin.unsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${DEDICATED_DB}' AND pid <> pg_backend_pid()
    `);
    await admin.unsafe(`DROP DATABASE ${DEDICATED_DB}`);
  }
  await admin.unsafe(`CREATE DATABASE ${DEDICATED_DB}`);
  console.log(`reset database ${DEDICATED_DB}`);
} finally {
  await admin.end();
}

// 2) Push our schema into the dedicated database.
const dedicated = withPath(base, DEDICATED_DB);
execSync("pnpm exec drizzle-kit push --force", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dedicated },
});
