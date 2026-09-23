import { sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { createLogger, setErrorReporter } from "@acme/logger";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import {
  db,
  createAdminSession,
  mockAuthWithSession,
  createTestClient,
  cleanup,
} from "./test-utils";

// Literal approved spec matrix: [primary key in declared order, ignore, redact].
// Do not derive this expectation from the schema or migration under test.
const approvedTracking = {
  achievements: [["id"], ["updated"], []],
  achievements_x_users: [
    ["achievement_id", "user_id", "award_year", "award_period"],
    [],
    [],
  ],
  api_keys: [["id"], ["updated"], ["key"]],
  attendance: [["id"], ["updated"], []],
  attendance_types: [["id"], ["updated"], []],
  attendance_x_attendance_types: [
    ["attendance_id", "attendance_type_id"],
    [],
    [],
  ],
  event_instances: [["id"], ["updated"], []],
  event_instances_x_event_types: [
    ["event_instance_id", "event_type_id"],
    [],
    [],
  ],
  event_tags: [["id"], ["updated"], []],
  event_tags_x_event_instances: [["event_instance_id", "event_tag_id"], [], []],
  event_tags_x_events: [["event_id", "event_tag_id"], [], []],
  event_types: [["id"], ["updated"], []],
  events: [["id"], ["updated"], []],
  events_x_event_types: [["event_id", "event_type_id"], [], []],
  locations: [["id"], ["updated"], []],
  orgs: [["id"], ["updated", "ao_count"], []],
  orgs_x_slack_spaces: [["org_id", "slack_space_id"], [], []],
  permissions: [["id"], ["updated"], []],
  positions: [["id"], ["updated"], []],
  positions_x_orgs_x_users: [["position_id", "org_id", "user_id"], [], []],
  roles: [["id"], ["updated"], []],
  roles_x_api_keys_x_org: [["role_id", "api_key_id", "org_id"], [], []],
  roles_x_permissions: [["role_id", "permission_id"], [], []],
  roles_x_users_x_org: [["role_id", "user_id", "org_id"], [], []],
  update_requests: [["id"], ["updated"], ["token"]],
  users: [["id"], ["updated"], []],
} satisfies Record<string, [string[], string[], string[]]>;
const tables = Object.keys(approvedTracking).sort();
type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
interface History extends Record<string, unknown> {
  row_id: string;
  op: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: number | null;
  changed_via: string | null;
}
const rollback = new Error("rollback audit fixture");
// Fixtures, role creation and DDL all roll back, including after assertion failures.
async function fixture(run: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE SCHEMA audit_fixture`);
      await tx.execute(sql`CREATE TABLE audit_fixture.rows (
        id integer PRIMARY KEY, value text, secret text, updated integer DEFAULT 0)`);
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (0, 'preexisting', NULL, 0)`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['secret'])`,
      );
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function history(tx: Tx) {
  return tx.execute<History>(
    sql`SELECT * FROM audit_fixture_history.rows ORDER BY id`,
  );
}
async function rejected(
  tx: Tx,
  statement: ReturnType<typeof sql>,
  message?: string,
) {
  // Savepoint preserves the fixture after the expected PostgreSQL error.
  const failure = tx.transaction(async (sp) => {
    await sp.execute(statement);
  });
  if (message)
    await expect(failure).rejects.toMatchObject({ cause: { message } });
  else
    await expect(failure).rejects.toMatchObject({ cause: { code: "42501" } });
}

describe("audit history migration (#664)", () => {
  it("deploys the approved primary-key, ignore and redaction options for every table", async () => {
    const rows = await db.execute<{ name: string; args: string }>(sql`
      SELECT c.relname AS name, encode(t.tgargs, 'hex') AS args
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE t.tgfoid='audit.log_change()'::regprocedure AND n.nspname='public'
      ORDER BY c.relname`);
    expect(
      rows.map(({ name, args }) => ({
        name,
        args: Buffer.from(args, "hex")
          .toString("utf8")
          .split("\0")
          .slice(0, -1),
      })),
    ).toEqual(
      Object.entries(approvedTracking)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, options]) => ({
          name,
          args: options.map((columns) => `{${columns.join(",")}}`),
        })),
    );
  });
  it("activates exactly the approved tables after the real reset/migration chain", async () => {
    const rows = await db.execute<{ name: string; triggers: number }>(sql`
      SELECT c.relname AS name, count(t.oid)::int AS triggers
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_trigger t ON t.tgrelid = c.oid
      WHERE t.tgfoid = 'audit.log_change()'::regprocedure AND n.nspname = 'public'
      GROUP BY c.relname ORDER BY c.relname`);
    expect(rows.map((r) => r.name)).toEqual(tables);
    expect(rows.every((r) => r.triggers === 1)).toBe(true);
    const hist = await db.execute<{ name: string }>(sql`
      SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public_history' ORDER BY tablename`);
    expect(hist.map((r) => r.name)).toEqual(tables);
    const other =
      await db.execute(sql`SELECT t.oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE t.tgfoid='audit.log_change()'::regprocedure
      AND n.nspname <> 'public'`);
    expect(other).toHaveLength(0);
    const publicGrants = await db.execute(sql`
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE n.nspname='audit' AND x.grantee <> p.proowner`);
    expect(publicGrants).toHaveLength(0);
    const writes = await db.execute(sql`
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) x
      WHERE n.nspname='public_history' AND x.grantee <> c.relowner
      AND (x.privilege_type <> 'SELECT' OR x.grantee=0)`);
    expect(writes).toHaveLength(0);
  });

  it("captures I/U/D snapshots, no backfill, no-op suppression and transaction timestamps", async () =>
    fixture(async (tx) => {
      expect(await history(tx)).toHaveLength(0);
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (1, 'before', 'synthetic-old-secret', 0)`,
      );
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET updated = 1 WHERE id = 1`,
      );
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET value = value WHERE id = 1`,
      );
      expect(await history(tx)).toHaveLength(1);
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET value = 'after', updated = 2 WHERE id = 1`,
      );
      await tx.execute(sql`DELETE FROM audit_fixture.rows WHERE id = 1`);
      const rows = await history(tx);
      expect(rows.map((r) => r.op)).toEqual(["I", "U", "D"]);
      expect(rows[0]).toMatchObject({
        row_id: "1",
        changed_by: null,
        changed_via: null,
        old_row: null,
        new_row: { value: "before", secret: "[redacted]" },
      });
      expect(rows[1]).toMatchObject({
        row_id: "1",
        old_row: { value: "before" },
        new_row: { value: "after", secret: "[redacted]", updated: 2 },
      });
      expect(rows[2]).toMatchObject({
        row_id: "1",
        new_row: null,
        old_row: { value: "after", secret: "[redacted]" },
      });
      const times = await tx.execute<{ same: boolean }>(
        sql`SELECT bool_and(changed_at = transaction_timestamp()) AS same FROM audit_fixture_history.rows`,
      );
      expect(times[0]?.same).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("synthetic-old-secret");
    }));

  it("records secret-only rotations, including NULL transitions, without retaining values", async () =>
    fixture(async (tx) => {
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (1, 'row', NULL, 0)`,
      );
      for (const secret of ["synthetic-a", "synthetic-b", null]) {
        await tx.execute(
          sql`UPDATE audit_fixture.rows SET secret = ${secret} WHERE id = 1`,
        );
      }
      const rows = await history(tx);
      expect(rows).toHaveLength(4);
      for (const row of rows.slice(1)) {
        expect(row).toMatchObject({
          old_row: { secret: "[redacted]" },
          new_row: { secret: "[redacted: changed]" },
        });
      }
      expect(JSON.stringify(rows)).not.toMatch(/synthetic-[ab]/);
    }));

  it("handles UUIDs, composite ordering/escaping and changed primary keys", async () =>
    fixture(async (tx) => {
      await tx.execute(
        sql`CREATE TABLE audit_fixture.composite (a text, b text, value text, PRIMARY KEY (b,a))`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.composite')`,
      );
      await tx.execute(
        sql`INSERT INTO audit_fixture.composite VALUES ('a:b', ${"c\\d"}, 'x')`,
      );
      await tx.execute(sql`UPDATE audit_fixture.composite SET b = 'next'`);
      await tx.execute(sql`DELETE FROM audit_fixture.composite`);
      const rows = await tx.execute<History>(
        sql`SELECT * FROM audit_fixture_history.composite ORDER BY id`,
      );
      expect(rows.map((r) => r.row_id)).toEqual([
        "c\\\\d:a\\:b",
        "next:a\\:b",
        "next:a\\:b",
      ]);
      expect(rows[1]?.old_row?.b).toBe("c\\d");
      await tx.execute(
        sql`CREATE TABLE audit_fixture.uuids (id uuid PRIMARY KEY)`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.uuids')`,
      );
      const id = "10000000-0000-4000-8000-000000000001";
      await tx.execute(sql`INSERT INTO audit_fixture.uuids VALUES (${id})`);
      const uuids = await tx.execute<{ row_id: string }>(
        sql`SELECT row_id FROM audit_fixture_history.uuids`,
      );
      expect(uuids[0]?.row_id).toBe(id);
    }));

  it.each(["rename", "drop", "null"])(
    "fails closed on stale composite keys (%s)",
    async (change) =>
      fixture(async (tx) => {
        await tx.execute(
          sql`CREATE TABLE audit_fixture.keys (a int, b int, updated int, PRIMARY KEY (a,b))`,
        );
        await tx.execute(
          sql`SELECT audit.enable_tracking('audit_fixture.keys', ARRAY['updated'])`,
        );
        await tx.execute(sql`INSERT INTO audit_fixture.keys VALUES (1,2,0)`);
        if (change === "rename") {
          await tx.execute(
            sql`ALTER TABLE audit_fixture.keys RENAME COLUMN b TO renamed`,
          );
        } else if (change === "drop") {
          await tx.execute(
            sql`ALTER TABLE audit_fixture.keys DROP COLUMN b CASCADE`,
          );
        } else {
          await tx.execute(
            sql`ALTER TABLE audit_fixture.keys DROP CONSTRAINT keys_pkey`,
          );
          await tx.execute(
            sql`ALTER TABLE audit_fixture.keys ALTER COLUMN b DROP NOT NULL`,
          );
        }
        for (const statement of [
          change === "null"
            ? sql`UPDATE audit_fixture.keys SET b=NULL`
            : change === "rename"
              ? sql`INSERT INTO audit_fixture.keys VALUES (3,4,0)`
              : sql`INSERT INTO audit_fixture.keys VALUES (3,0)`,
          change === "null"
            ? sql`INSERT INTO audit_fixture.keys (a) VALUES (3)`
            : sql`UPDATE audit_fixture.keys SET updated=1`,
          ...(change === "null" ? [] : [sql`DELETE FROM audit_fixture.keys`]),
        ])
          await rejected(tx, statement, "Audit history capture failed");
        const rows = await tx.execute(sql`SELECT * FROM audit_fixture.keys`);
        expect(rows).toHaveLength(1);
        const historyRows = await tx.execute(
          sql`SELECT row_id FROM audit_fixture_history.keys`,
        );
        expect(historyRows).toEqual([{ row_id: "1:2" }]);
        if (change === "rename") {
          await tx.execute(
            sql`SELECT audit.enable_tracking('audit_fixture.keys', ARRAY['updated'])`,
          );
          await tx.execute(sql`UPDATE audit_fixture.keys SET renamed=4`);
          const repaired = await tx.execute(
            sql`SELECT row_id FROM audit_fixture_history.keys ORDER BY id`,
          );
          expect(repaired).toEqual([{ row_id: "1:2" }, { row_id: "1:4" }]);
        }
      }),
  );

  it("enforces the operation constraint and rejects missing or weakened constraints on re-enable", async () =>
    fixture(async (tx) => {
      await expect(
        tx.transaction(async (sp) => {
          await sp.execute(
            sql`INSERT INTO audit_fixture_history.rows (row_id, op) VALUES ('1','X')`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['secret'])`,
      );
      await tx.execute(
        sql`ALTER TABLE audit_fixture_history.rows DROP CONSTRAINT audit_history_op`,
      );
      await rejected(
        tx,
        sql`SELECT audit.enable_tracking('audit_fixture.rows')`,
        "audit.enable_tracking: incompatible history object",
      );
      await tx.execute(
        sql`ALTER TABLE audit_fixture_history.rows ADD CONSTRAINT audit_history_op CHECK (op IN ('I','U','D','X'))`,
      );
      await rejected(
        tx,
        sql`SELECT audit.enable_tracking('audit_fixture.rows')`,
        "audit.enable_tracking: incompatible history object",
      );
    }));

  it.each(["rewrite", "unlogged"])(
    "rejects a history table changed to %s on re-enable",
    async (change) =>
      fixture(async (tx) => {
        expect.assertions(1);
        if (change === "rewrite") {
          await tx.execute(
            sql`CREATE RULE discard_history AS ON INSERT TO audit_fixture_history.rows DO INSTEAD NOTHING`,
          );
        } else {
          await tx.execute(
            sql`ALTER TABLE audit_fixture_history.rows SET UNLOGGED`,
          );
        }
        await rejected(
          tx,
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['secret'])`,
          "audit.enable_tracking: incompatible history object",
        );
      }),
  );

  it("rejects missing keys, invalid/conflicting options and incompatible objects atomically", async () =>
    fixture(async (tx) => {
      await tx.execute(sql`CREATE TABLE audit_fixture.no_key (value text)`);
      await rejected(
        tx,
        sql`SELECT audit.enable_tracking('audit_fixture.no_key')`,
        "audit.enable_tracking: table has no primary key",
      );
      const absent = await tx.execute<{ value: string | null }>(
        sql`SELECT to_regclass('audit_fixture_history.no_key')::text AS value`,
      );
      expect(absent[0]?.value).toBeNull();
      for (const [statement, reason] of [
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['unknown'])`,
          "unknown option column",
        ],
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['secret'], ARRAY['secret'])`,
          "ignore/redact overlap",
        ],
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY[]::text[], ARRAY['id'])`,
          "cannot redact primary key",
        ],
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['id'])`,
          "cannot ignore primary key",
        ],
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', NULL)`,
          "options must be non-null arrays",
        ],
        [
          sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY[NULL]::text[])`,
          "unknown option column",
        ],
      ] as const)
        await rejected(tx, statement, `audit.enable_tracking: ${reason}`);
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (1, 'still tracked', 'synthetic-secret', 0)`,
      );
      expect((await history(tx))[0]?.new_row?.secret).toBe("[redacted]");
      await tx.execute(
        sql`CREATE TABLE audit_fixture.bad (id int PRIMARY KEY)`,
      );
      await tx.execute(
        sql`CREATE TABLE audit_fixture_history.bad (wrong text)`,
      );
      await rejected(
        tx,
        sql`SELECT audit.enable_tracking('audit_fixture.bad')`,
        "audit.enable_tracking: incompatible history object",
      );
      await tx.execute(
        sql`ALTER TABLE audit_fixture_history.rows ADD COLUMN incompatible text`,
      );
      await rejected(
        tx,
        sql`SELECT audit.enable_tracking('audit_fixture.rows')`,
        "audit.enable_tracking: incompatible history object",
      );
      expect((await history(tx))[0]?.new_row?.secret).toBe("[redacted]");
      await tx.execute(sql`INSERT INTO audit_fixture.rows (id) VALUES (2)`);
      expect(await history(tx)).toHaveLength(2);
    }));

  it.each(["rename", "drop"])(
    "fails closed after a masked column %s until reconfigured",
    async (change) =>
      fixture(async (tx) => {
        if (change === "rename")
          await tx.execute(
            sql`ALTER TABLE audit_fixture.rows RENAME COLUMN secret TO renamed_secret`,
          );
        else
          await tx.execute(
            sql`ALTER TABLE audit_fixture.rows DROP COLUMN secret`,
          );
        for (const statement of [
          sql`INSERT INTO audit_fixture.rows (id) VALUES (1)`,
          sql`UPDATE audit_fixture.rows SET updated=updated WHERE id=0`,
          sql`DELETE FROM audit_fixture.rows WHERE id=0`,
        ])
          await rejected(tx, statement, "Audit history capture failed");
        expect(await history(tx)).toHaveLength(0);
        if (change === "rename") {
          await tx.execute(
            sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['renamed_secret'])`,
          );
          await tx.execute(
            sql`INSERT INTO audit_fixture.rows (id, renamed_secret) VALUES (1, 'synthetic-secret')`,
          );
          expect((await history(tx))[0]?.new_row?.renamed_secret).toBe(
            "[redacted]",
          );
        }
      }),
  );

  it("reconfigures future capture, preserves history, and disables/re-enables once", async () =>
    fixture(async (tx) => {
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (1, 'first', 'synthetic-secret', 0)`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['secret'])`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated','value'], ARRAY['secret'])`,
      );
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET value='ignored' WHERE id=1`,
      );
      expect(await history(tx)).toHaveLength(1);
      await tx.execute(
        sql`SELECT audit.disable_tracking('audit_fixture.rows')`,
      );
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET secret='not captured' WHERE id=1`,
      );
      expect(await history(tx)).toHaveLength(1);
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.rows', ARRAY['updated'], ARRAY['secret'])`,
      );
      await tx.execute(
        sql`UPDATE audit_fixture.rows SET value='captured' WHERE id=1`,
      );
      const rows = await history(tx);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.new_row?.value).toBe("first");
      expect(rows[1]?.new_row?.value).toBe("captured");
    }));

  it("captures added source columns without altering the history schema", async () =>
    fixture(async (tx) => {
      await tx.execute(
        sql`ALTER TABLE audit_fixture.rows ADD COLUMN extra text`,
      );
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows (id, extra) VALUES (1, 'new-column')`,
      );
      expect((await history(tx))[0]?.new_row?.extra).toBe("new-column");
    }));

  it("suppresses cascading AO counts while retaining meaningful org edits", async () =>
    fixture(async (tx) => {
      const [region] = await tx.execute<{
        id: number;
      }>(sql`INSERT INTO public.orgs (name,org_type,is_active)
      VALUES ('Audit region','region',true) RETURNING id`);
      if (!region) throw new Error("Missing region fixture");
      await tx.execute(sql`INSERT INTO public.orgs (name,org_type,parent_id,is_active)
      VALUES ('Audit AO','ao',${region.id},true)`);
      const [count] = await tx.execute<{ ao_count: number }>(
        sql`SELECT ao_count FROM public.orgs WHERE id=${region.id}`,
      );
      expect(count?.ao_count).toBe(1);
      const before = await tx.execute<History>(
        sql`SELECT * FROM public_history.orgs WHERE row_id=${String(region.id)}`,
      );
      expect(before.map((r) => r.op)).toEqual(["I"]);
      await tx.execute(
        sql`UPDATE public.orgs SET name='Audit region renamed', updated=now() WHERE id=${region.id}`,
      );
      const after = await tx.execute<History>(
        sql`SELECT * FROM public_history.orgs WHERE row_id=${String(region.id)} ORDER BY id`,
      );
      expect(after.map((r) => r.op)).toEqual(["I", "U"]);
      expect(after[1]?.new_row?.name).toBe("Audit region renamed");
    }));

  it("masks the actual update-request token without changing the source token", async () =>
    fixture(async (tx) => {
      const [region] = await tx.execute<{
        id: number;
      }>(sql`INSERT INTO public.orgs (name,org_type,is_active)
      VALUES ('Audit request region','region',true) RETURNING id`);
      if (!region) throw new Error("Missing region fixture");
      const [request] = await tx.execute<{ id: string; token: string }>(sql`
      INSERT INTO public.update_requests (region_id, submitted_by, request_type)
      VALUES (${region.id}, 'audit@example.com', 'create_ao_and_location_and_event') RETURNING id, token`);
      if (!request) throw new Error("Missing request fixture");
      const rows = await tx.execute<History>(
        sql`SELECT * FROM public_history.update_requests WHERE row_id=${request.id}`,
      );
      expect(rows[0]?.new_row?.token).toBe("[redacted]");
      expect(JSON.stringify(rows)).not.toContain(request.token);
      const [source] = await tx.execute<{ token: string }>(
        sql`SELECT token FROM public.update_requests WHERE id=${request.id}`,
      );
      expect(source?.token).toBe(request.token);
      const rotated = "10000000-0000-4000-8000-000000000002";
      await tx.execute(
        sql`UPDATE public.update_requests SET token=${rotated} WHERE id=${request.id}`,
      );
      await tx.execute(
        sql`DELETE FROM public.update_requests WHERE id=${request.id}`,
      );
      const all = await tx.execute<History>(
        sql`SELECT * FROM public_history.update_requests WHERE row_id=${request.id} ORDER BY id`,
      );
      expect(all.map((r) => r.op)).toEqual(["I", "U", "D"]);
      expect(all[1]).toMatchObject({
        old_row: { token: "[redacted]" },
        new_row: { token: "[redacted: changed]" },
      });
      expect(all[2]).toMatchObject({
        old_row: { token: "[redacted]" },
        new_row: null,
      });
      expect(JSON.stringify(all)).not.toContain(request.token);
      expect(JSON.stringify(all)).not.toContain(rotated);
    }));

  it("rolls source and history back together and sanitizes capture failures", async () =>
    fixture(async (tx) => {
      await expect(
        tx.transaction(async (sp) => {
          await sp.execute(sql`INSERT INTO audit_fixture.rows (id) VALUES (1)`);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await history(tx)).toHaveLength(0);
      expect(
        await tx.execute(sql`SELECT id FROM audit_fixture.rows WHERE id=1`),
      ).toHaveLength(0);
      // Deliberately malicious diagnostic text exercises the trigger's safe error boundary.
      await tx.execute(sql`CREATE FUNCTION audit_fixture.fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic-secret-in-error' USING DETAIL='synthetic-secret-in-detail'; END $$`);
      await tx.execute(sql`CREATE TRIGGER fail BEFORE INSERT ON audit_fixture_history.rows
      FOR EACH ROW EXECUTE FUNCTION audit_fixture.fail()`);
      let failure: unknown;
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(
            sql`INSERT INTO audit_fixture.rows VALUES (1, 'x', 'synthetic-secret', 0)`,
          );
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      const cause = (failure as { cause?: unknown }).cause;
      expect(String(cause)).toContain("Audit history capture failed");
      expect(JSON.stringify(cause)).not.toContain("synthetic-secret");
      expect(cause).toMatchObject({
        message: "Audit history capture failed",
        code: "P0001",
      });
      const instance = createLogger("audit-integration");
      const output = vi
        .spyOn(instance.logger, "error")
        .mockImplementation(() => undefined);
      const reporter = vi.fn();
      setErrorReporter(reporter);
      try {
        instance.logError("api.audit.failed", {}, failure);
        const safe = reporter.mock.lastCall?.[2] as Error;
        expect(safe).toMatchObject({
          message: "Audit history capture failed",
          code: "P0001",
        });
        expect(safe.cause).toBeUndefined();
        expect(safe.stack).not.toContain("synthetic-secret");
        expect(output).toHaveBeenCalledWith({ err: safe }, "api.audit.failed");
      } finally {
        output.mockRestore();
        setErrorReporter(() => undefined);
      }
      expect(
        await tx.execute(sql`SELECT id FROM audit_fixture.rows WHERE id=1`),
      ).toHaveLength(0);
      expect(await history(tx)).toHaveLength(0);
    }));

  it("masks real API-key INSERT, secret-only UPDATE and DELETE snapshots", async () =>
    fixture(async (tx) => {
      const [key] = await tx.execute<{
        id: number;
      }>(sql`INSERT INTO public.api_keys (name, key)
        VALUES ('audit matrix', 'synthetic-matrix-old') RETURNING id`);
      expect(key).toBeDefined();
      await tx.execute(
        sql`UPDATE public.api_keys SET key='synthetic-matrix-new' WHERE id=${key!.id}`,
      );
      await tx.execute(sql`DELETE FROM public.api_keys WHERE id=${key!.id}`);
      const rows = await tx.execute<History>(
        sql`SELECT * FROM public_history.api_keys WHERE row_id=${String(key!.id)} ORDER BY id`,
      );
      expect(rows.map((r) => r.op)).toEqual(["I", "U", "D"]);
      expect(rows[0]).toMatchObject({
        old_row: null,
        new_row: { key: "[redacted]" },
      });
      expect(rows[1]).toMatchObject({
        old_row: { key: "[redacted]" },
        new_row: { key: "[redacted: changed]" },
      });
      expect(rows[2]).toMatchObject({
        old_row: { key: "[redacted]" },
        new_row: null,
      });
      expect(JSON.stringify(rows)).not.toContain("synthetic-matrix");
    }));

  it("removes inherited default table/sequence grants and history schema CREATE", async () =>
    fixture(async (tx) => {
      await tx.execute(sql`CREATE ROLE audit_default_writer NOLOGIN`);
      await tx.execute(
        sql`ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO audit_default_writer`,
      );
      await tx.execute(
        sql`ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO audit_default_writer`,
      );
      await tx.execute(
        sql`GRANT USAGE, CREATE ON SCHEMA audit_fixture_history TO audit_default_writer`,
      );
      await tx.execute(
        sql`CREATE TABLE audit_fixture.defaults (id integer PRIMARY KEY)`,
      );
      await tx.execute(
        sql`SELECT audit.enable_tracking('audit_fixture.defaults')`,
      );
      const [acl] = await tx.execute<{
        table_write: boolean;
        sequence_write: boolean;
        schema_create: boolean;
      }>(sql`
        SELECT has_table_privilege('audit_default_writer', 'audit_fixture_history.defaults', 'INSERT') AS table_write,
        has_sequence_privilege('audit_default_writer', pg_get_serial_sequence('audit_fixture_history.defaults','id'), 'USAGE') AS sequence_write,
        has_schema_privilege('audit_default_writer','audit_fixture_history','CREATE') AS schema_create`);
      expect(acl).toEqual({
        table_write: false,
        sequence_write: false,
        schema_create: false,
      });
    }));

  it.each(["", "abc", "-1", "1.5", " 1", "2147483648", "99999999999999999999"])(
    "ignores invalid attribution %j without failing the source write",
    async (value) =>
      fixture(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.user_id', ${value}, true), set_config('app.source', '', true)`,
        );
        await tx.execute(sql`INSERT INTO audit_fixture.rows (id) VALUES (1)`);
        expect((await history(tx))[0]).toMatchObject({
          changed_by: null,
          changed_via: null,
        });
      }),
  );

  it.each(["0", "1", "0000000001", "2147483647"])(
    "records valid transaction-local attribution %s",
    async (value) =>
      fixture(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.user_id', ${value}, true), set_config('app.source', 'audit-test', true)`,
        );
        await tx.execute(sql`INSERT INTO audit_fixture.rows (id) VALUES (1)`);
        expect((await history(tx))[0]).toMatchObject({
          changed_by: Number(value),
          changed_via: "audit-test",
        });
      }),
  );

  it("does not leak attribution from committed or rolled-back transactions on the same connection", async () => {
    // A reserved single-client connection makes connection reuse deterministic.
    const { default: postgres } = await import("postgres");
    const { env } = await import("@acme/env");
    const client = postgres(env.TEST_DATABASE_URL!, { max: 1, prepare: false });
    const namespace = `audit_attribution_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let created = false;
    try {
      await client`CREATE SCHEMA ${client(namespace)}`;
      created = true;
      await client`CREATE TABLE ${client(namespace)}.rows (id integer PRIMARY KEY)`;
      await client`SELECT audit.enable_tracking(${`${namespace}.rows`}::regclass)`;
      let id = 0;
      for (const abort of [false, true]) {
        try {
          await client.begin(async (c) => {
            await c`SELECT set_config('app.user_id','7',true), set_config('app.source','test',true)`;
            await c`INSERT INTO ${c(namespace)}.rows VALUES (${++id})`;
            const attributed =
              await c`SELECT changed_by, changed_via FROM ${c(`${namespace}_history`)}.rows WHERE row_id=${String(id)}`;
            expect(attributed).toMatchObject([
              { changed_by: 7, changed_via: "test" },
            ]);
            if (abort) throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
        await client`INSERT INTO ${client(namespace)}.rows VALUES (${++id})`;
        const rows =
          await client`SELECT changed_by, changed_via FROM ${client(`${namespace}_history`)}.rows WHERE row_id=${String(id)}`;
        expect(rows).toMatchObject([{ changed_by: null, changed_via: null }]);
      }
    } finally {
      try {
        if (created) {
          await client`DROP SCHEMA ${client(namespace)} CASCADE`;
          await client`DROP SCHEMA IF EXISTS ${client(`${namespace}_history`)} CASCADE`;
        }
      } finally {
        await client.end();
      }
    }
  });

  it("enforces history grants for all 26 tables and permits source writers through the trigger", async () =>
    fixture(async (tx) => {
      // All synthetic roles are transaction-scoped and rolled back with the fixture.
      await tx.execute(sql`CREATE ROLE audit_test_writer NOLOGIN`);
      await tx.execute(sql`CREATE ROLE audit_test_reader NOLOGIN`);
      await tx.execute(sql`CREATE ROLE audit_test_denied NOLOGIN`);
      await tx.execute(
        sql`GRANT USAGE ON SCHEMA public, audit_fixture TO audit_test_writer`,
      );
      await tx.execute(
        sql`GRANT INSERT, UPDATE, DELETE, SELECT ON audit_fixture.rows TO audit_test_writer`,
      );
      // Give the writer real history access first so only the helper's ACL
      // cleanup can remove it; schema-level denial cannot satisfy these checks.
      await tx.execute(
        sql`GRANT USAGE ON SCHEMA public_history, audit TO audit_test_writer, audit_test_reader, audit_test_denied`,
      );
      await tx.execute(
        sql`GRANT ALL ON ALL TABLES IN SCHEMA public_history TO audit_test_writer`,
      );
      await tx.execute(
        sql`GRANT UPDATE (new_row) ON public_history.users TO audit_test_writer`,
      );
      await tx.execute(
        sql`GRANT SELECT (new_row) ON public_history.users TO audit_test_denied`,
      );
      // Re-enable tracking to verify cleanup of non-owner history grants.
      for (const table of tables) {
        const columns = await tx.execute<{
          updated: boolean;
        }>(sql`SELECT EXISTS (
        SELECT FROM information_schema.columns WHERE table_schema='public'
        AND table_name=${table} AND column_name='updated') AS updated`);
        const ignored = columns[0]?.updated
          ? table === "orgs"
            ? ["updated", "ao_count"]
            : ["updated"]
          : [];
        const masked =
          table === "api_keys"
            ? ["key"]
            : table === "update_requests"
              ? ["token"]
              : [];
        await tx.execute(sql`SELECT audit.enable_tracking(${`public.${table}`}::regclass,
        ${`{${ignored.join(",")}}`}::text[], ${`{${masked.join(",")}}`}::text[])`);
      }
      for (const table of tables) {
        const name = sql.identifier(table);
        const [acl] = await tx.execute<{ writable: boolean }>(
          sql`SELECT has_any_column_privilege('audit_test_writer', ${`public_history.${table}`}, 'UPDATE') AS writable`,
        );
        expect(acl?.writable).toBe(false);
        await tx.transaction(async (sp) => {
          await sp.execute(sql`SET LOCAL ROLE audit_test_reader`);
          await rejected(sp, sql`SELECT 1 FROM public_history.${name}`);
          await sp.execute(sql`RESET ROLE`);
        });
        // Model the operator's separate, explicit reader provisioning.
        await tx.execute(
          sql`GRANT SELECT ON public_history.${name} TO audit_test_reader`,
        );
        await tx.transaction(async (sp) => {
          await sp.execute(sql`SET LOCAL ROLE audit_test_reader`);
          await sp.execute(sql`SELECT 1 FROM public_history.${name} LIMIT 1`);
          await sp.execute(sql`RESET ROLE`);
        });
        for (const role of [
          "audit_test_writer",
          "audit_test_reader",
          "audit_test_denied",
        ]) {
          await tx.transaction(async (sp) => {
            await sp.execute(sql`SET LOCAL ROLE ${sql.identifier(role)}`);
            for (const stmt of [
              sql`INSERT INTO public_history.${name} (row_id,op) VALUES ('1','I')`,
              sql`UPDATE public_history.${name} SET op='D'`,
              sql`DELETE FROM public_history.${name}`,
              sql`SELECT audit.enable_tracking(${`public.${table}`}::regclass)`,
              sql`SELECT audit.disable_tracking(${`public.${table}`}::regclass)`,
              sql`ALTER TABLE public_history.${name} ADD COLUMN forbidden int`,
            ])
              await rejected(sp, stmt);
            if (role !== "audit_test_reader")
              await rejected(sp, sql`SELECT 1 FROM public_history.${name}`);
            await sp.execute(sql`RESET ROLE`);
          });
        }
      }
      await tx.execute(sql`SET LOCAL ROLE audit_test_writer`);
      await tx.execute(
        sql`INSERT INTO audit_fixture.rows VALUES (1, 'writer', 'synthetic-secret', 0)`,
      );
      await rejected(tx, sql`SELECT 1 FROM audit_fixture_history.rows`);
      await tx.execute(sql`RESET ROLE`);
      expect((await history(tx))[0]?.new_row?.secret).toBe("[redacted]");
      await tx.execute(sql`SET LOCAL ROLE audit_test_denied`);
      await rejected(tx, sql`INSERT INTO audit_fixture.rows (id) VALUES (2)`);
      await tx.execute(sql`RESET ROLE`);
      expect(await history(tx)).toHaveLength(1);
    }));

  it("records a real API-router creation and deletion with a masked API key", async () => {
    await mockAuthWithSession(await createAdminSession());
    const result = await createTestClient().apiKey.create({
      name: "audit integration",
    });
    try {
      const rows = await db.execute<History>(
        sql`SELECT * FROM public_history.api_keys WHERE row_id=${String(result.id)} ORDER BY id`,
      );
      expect(rows[0]).toMatchObject({
        op: "I",
        old_row: null,
        new_row: { key: "[redacted]" },
      });
      expect(JSON.stringify(rows)).not.toContain(result.key);
    } finally {
      await cleanup.apiKey(result.id);
    }
    const deleted = await db.execute<History>(
      sql`SELECT * FROM public_history.api_keys WHERE row_id=${String(result.id)} AND op='D'`,
    );
    expect(deleted[0]).toMatchObject({
      new_row: null,
      old_row: { key: "[redacted]" },
    });
  });
});
