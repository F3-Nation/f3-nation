import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, it } from "vitest";

interface HistoryRow {
  op: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsFolder = `${packageRoot}/drizzle`;

it("loads every registered migration before attempting a database connection", () => {
  const migrations = readMigrationFiles({ migrationsFolder });
  assert.ok(migrations.length > 0);
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "audit history on a freshly migrated database",
  () => {
    const databaseName = `audit_${randomUUID().replaceAll("-", "")}_test`;
    let admin: postgres.Sql | undefined;
    let db: postgres.Sql;
    let databaseUrl: string;
    let created = false;

    const resetAndMigrate = () => {
      execFileSync(
        process.execPath,
        ["--require", "esbuild-register", "src/utils/run-reset-test-db.ts"],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            SKIP_ENV_VALIDATION: "1",
            SKIP_RESET_TEST_DB: "0",
            TEST_DATABASE_URL: databaseUrl,
          },
          timeout: 60_000,
          stdio: "pipe",
        },
      );
    };

    beforeAll(async () => {
      const url = new URL(process.env.TEST_DATABASE_URL!);
      assert.ok(url.pathname.endsWith("_test"), "Use a test database URL");
      url.pathname = "/postgres";
      admin = postgres(url.toString(), { max: 1 });
      await admin`CREATE DATABASE ${admin(databaseName)}`;
      created = true;
      url.pathname = `/${databaseName}`;
      databaseUrl = url.toString();
      resetAndMigrate();
      db = postgres(databaseUrl, { max: 1, prepare: false });
    });

    afterAll(async () => {
      try {
        if (db) await db.end();
        if (created && admin) await admin`DROP DATABASE ${admin(databaseName)}`;
      } finally {
        await admin?.end();
      }
    });

    it("installs history for all 26 public, seven Codex, and one auth table", async () => {
      const rows = await db`
        SELECT n.nspname AS schema, count(*)::integer AS count
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname LIKE 'zz_audit_%'
        GROUP BY n.nspname ORDER BY n.nspname
      `;
      assert.deepEqual(Array.from(rows), [
        { schema: "auth", count: 1 },
        { schema: "codex", count: 7 },
        { schema: "public", count: 26 },
      ]);
    });

    it("records Codex inserts, edits and deletes while suppressing timestamp touches", async () => {
      await db`INSERT INTO codex.entries
        (id, title, definition, type, created_at, updated_at)
        VALUES ('audit-entry', 'Original', 'Definition', 'test', now(), now())`;
      await db`UPDATE codex.entries SET updated_at = now() + interval '1 minute'
        WHERE id = 'audit-entry'`;
      await db`UPDATE codex.entries SET title = 'Edited' WHERE id = 'audit-entry'`;
      await db`DELETE FROM codex.entries WHERE id = 'audit-entry'`;
      const rows = await db<
        HistoryRow[]
      >`SELECT op, old_row, new_row FROM codex_history.entries
        WHERE row_id = 'audit-entry' ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => row.op),
        ["I", "U", "D"],
      );
      assert.equal(rows[0]!.old_row, null);
      assert.equal(rows[1]!.old_row?.title, "Original");
      assert.equal(rows[1]!.new_row?.title, "Edited");
      assert.equal(rows[2]!.new_row, null);

      await db`INSERT INTO codex.tags (name) VALUES ('audit-tag')`;
      await db`UPDATE codex.tags SET "updatedAt" = now() + interval '1 minute'
        WHERE name = 'audit-tag'`;
      const tagHistory = await db<
        { op: string }[]
      >`SELECT op FROM codex_history.tags WHERE row_id = 'audit-tag'`;
      assert.deepEqual(
        tagHistory.map((row) => row.op),
        ["I"],
      );
    });

    it("distinguishes text composite keys containing colons and backslashes", async () => {
      const pairs = [
        ["a:b", "c"],
        ["a", "b:c"],
        ["a\\:b", "c"],
      ];
      for (const [entry, tag] of pairs) {
        await db`INSERT INTO codex.entry_tags (entry_id, tag_id) VALUES (${entry!}, ${tag!})`;
      }
      const rows = await db<
        { row_id: string }[]
      >`SELECT row_id FROM codex_history.entry_tags ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => row.row_id),
        ["a\\:b:c", "a:b\\:c", "a\\\\\\:b:c"],
      );
    });

    it("redacts API keys while preserving metadata and rotation history", async () => {
      const [key] = await db<
        { id: number }[]
      >`INSERT INTO public.api_keys (key, name)
        VALUES ('synthetic-api-before', 'Audit API key') RETURNING id`;
      await db`UPDATE public.api_keys SET name = 'Renamed audit API key'
        WHERE id = ${key!.id}`;
      await db`UPDATE public.api_keys SET key = 'synthetic-api-after'
        WHERE id = ${key!.id}`;
      await db`DELETE FROM public.api_keys WHERE id = ${key!.id}`;
      const rows = await db<HistoryRow[]>`SELECT op, old_row, new_row
        FROM public_history.api_keys WHERE row_id = ${String(key!.id)} ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => row.op),
        ["I", "U", "U", "D"],
      );
      assert.equal(rows[0]!.old_row, null);
      assert.equal(rows[0]!.new_row?.key, "[redacted]");
      assert.equal(rows[0]!.new_row?.name, "Audit API key");
      assert.equal(rows[1]!.old_row?.key, "[redacted]");
      assert.equal(rows[1]!.new_row?.key, "[redacted]");
      assert.equal(rows[1]!.new_row?.name, "Renamed audit API key");
      assert.equal(rows[2]!.old_row?.key, "[redacted]");
      assert.equal(rows[2]!.new_row?.key, "[redacted: changed]");
      assert.equal(rows[3]!.old_row?.key, "[redacted]");
      assert.equal(rows[3]!.new_row, null);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /synthetic-api-before|synthetic-api-after/,
      );
    });

    it("redacts OAuth secrets while recording rotations", async () => {
      await db`INSERT INTO auth.oauth_clients
        (id, name, client_secret_hash, redirect_uris, allowed_origin)
        VALUES ('audit-client', 'Audit test', 'synthetic-before', '[]', 'https://example.test')`;
      await db`UPDATE auth.oauth_clients SET client_secret_hash = 'synthetic-after'
        WHERE id = 'audit-client'`;
      await db`DELETE FROM auth.oauth_clients WHERE id = 'audit-client'`;
      const rows = await db<
        HistoryRow[]
      >`SELECT op, old_row, new_row FROM auth_history.oauth_clients
        WHERE row_id = 'audit-client' ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => row.op),
        ["I", "U", "D"],
      );
      assert.equal(rows[0]!.new_row?.client_secret_hash, "[redacted]");
      assert.equal(rows[1]!.old_row?.client_secret_hash, "[redacted]");
      assert.equal(rows[1]!.new_row?.client_secret_hash, "[redacted: changed]");
      assert.equal(rows[2]!.old_row?.client_secret_hash, "[redacted]");
      assert.doesNotMatch(
        JSON.stringify(rows),
        /synthetic-before|synthetic-after/,
      );
    });

    it("clears all history and Codex data on repeated resets", async () => {
      for (let cycle = 0; cycle < 2; cycle++) {
        await db`INSERT INTO public.orgs (name, org_type, is_active)
          VALUES ('Audit reset marker', 'nation', true)`;
        await db`INSERT INTO codex.admins (email) VALUES ('audit-reset@example.test')`;
        await db`INSERT INTO auth.oauth_clients
          (id, name, client_secret_hash, redirect_uris, allowed_origin)
          VALUES ('reset-client', 'Reset marker', 'synthetic-reset', '[]', 'https://example.test')`;
        await db.end();
        resetAndMigrate();
        db = postgres(databaseUrl, { max: 1, prepare: false });
        const [counts] = await db`SELECT
          (SELECT count(*) FROM codex.admins)::integer AS admins,
          (SELECT count(*) FROM codex_history.admins)::integer AS admin_history,
          (SELECT count(*) FROM auth_history.oauth_clients)::integer AS client_history,
          (SELECT count(*) FROM public_history.orgs
           WHERE new_row->>'name' = 'Audit reset marker')::integer AS org_history`;
        assert.deepEqual(counts, {
          admins: 0,
          admin_history: 0,
          client_history: 0,
          org_history: 0,
        });
      }
    });
  },
);
