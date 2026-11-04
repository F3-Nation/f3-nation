import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schema } from "..";
import { createAuditDatabase } from "../__tests__/audit-database";
import { runWithAuditContext, withAuditContext } from "./audit-context";
import { createDbClient } from "./functions";
import { withQueryTimeout } from "./query-timeout";

// Route the production factory to this suite's isolated fixture database.
const fixture = vi.hoisted(() => ({ url: "" }));
vi.mock("@acme/env", () => ({
  env: {
    get TEST_DATABASE_URL() {
      return fixture.url;
    },
  },
}));

const table = schema.attendanceTypes;
const actor = { userId: 41, source: null };
let owned: Awaited<ReturnType<typeof createAuditDatabase>>;
let production: ReturnType<typeof createDbClient>;
let client: postgres.Sql;
let db: ReturnType<typeof drizzle>;
const statements: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  owned = await createAuditDatabase();
  cleanups.push(owned.cleanup);
  fixture.url = owned.url;
  production = createDbClient();
  cleanups.push(production.close);
  client = postgres(owned.url, {
    max: 2,
    prepare: false,
    onnotice: () => undefined,
    debug: (_connection, query) => statements.push(query),
  });
  cleanups.push(() => client.end());
  withAuditContext(client);
  db = drizzle(client);
}, 30_000);

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function history(type: string) {
  return client<
    { op: string; changed_by: number | null; changed_via: string | null }[]
  >`
    select op, changed_by, changed_via from public_history.attendance_types
    where coalesce(new_row, old_row)->>'type' = ${type} order by id`;
}

describe("database audit attribution", () => {
  it("refuses to initialize from another unmarked local test database", async () => {
    vi.stubEnv("TEST_DATABASE_URL", owned.url);
    try {
      await expect(createAuditDatabase()).rejects.toThrow(
        "verified disposable test database",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("installs attribution in createDbClient and preserves INSERT UPDATE DELETE returning", async () => {
    const inserted = await runWithAuditContext(actor, async () =>
      production.db
        .insert(table)
        .values({ type: "factory" })
        .returning({ id: table.id, type: table.type }),
    );
    expect(inserted.map((row) => row.type)).toEqual(["factory"]);
    const id = inserted[0]!.id;
    expect(id).toBeGreaterThan(0);
    expect(
      await runWithAuditContext(actor, async () =>
        production.db
          .update(table)
          .set({ description: "changed" })
          .where(eq(table.id, id))
          .returning({ id: table.id, description: table.description }),
      ),
    ).toEqual([{ id, description: "changed" }]);
    expect(
      await runWithAuditContext(actor, async () =>
        production.db
          .delete(table)
          .where(eq(table.id, id))
          .returning({ id: table.id }),
      ),
    ).toEqual([{ id }]);
    expect(await history("factory")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
      { op: "U", changed_by: 41, changed_via: null },
      { op: "D", changed_by: 41, changed_via: null },
    ]);
  });

  it("attributes raw Drizzle execute and resolves after commit", async () => {
    const result = await runWithAuditContext(actor, async () =>
      db.execute(
        sql`insert into attendance_types(type) values ('raw') returning type`,
      ),
    );
    expect([...result]).toEqual([{ type: "raw" }]);
    await runWithAuditContext(actor, async () =>
      db.execute(
        sql`update attendance_types set description = 'raw update' where type = 'raw'`,
      ),
    );
    expect(await history("raw")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
      { op: "U", changed_by: 41, changed_via: null },
    ]);
  });

  it("attributes transactions and nested savepoints through the installed adapter", async () => {
    statements.length = 0;
    expect(
      await runWithAuditContext(actor, () =>
        db.transaction(async (tx) => {
          await tx.insert(table).values({ type: "outer" });
          return tx.transaction(async (nested) => {
            await nested.insert(table).values({ type: "nested" });
            return 23;
          });
        }),
      ),
    ).toBe(23);
    expect(statements.some((query) => /^savepoint /i.test(query))).toBe(true);
    expect(await history("outer")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
    expect(await history("nested")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
  });

  it("preserves serializable and deferrable transaction configuration", async () => {
    await runWithAuditContext(actor, () =>
      db.transaction(
        async (tx) => {
          expect([
            ...(await tx.execute(
              sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_deferrable') as deferrable`,
            )),
          ]).toEqual([{ isolation: "serializable", deferrable: "on" }]);
          await tx.insert(table).values({ type: "serializable" });
        },
        { isolationLevel: "serializable", deferrable: true },
      ),
    );
    expect(await history("serializable")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
  });

  it("rolls back both source and history and clears pooled attribution after commit and rollback", async () => {
    const single = postgres(owned.url, { max: 1, prepare: false });
    withAuditContext(single);
    const singleDb = drizzle(single);
    try {
      const [first] = await single<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      await runWithAuditContext({ userId: 54, source: "committed" }, async () =>
        singleDb.insert(table).values({ type: "committed" }),
      );
      await singleDb.insert(table).values({ type: "after-commit" });
      await expect(
        runWithAuditContext({ userId: 55, source: "rolled-back" }, () =>
          singleDb.transaction(async (tx) => {
            await tx.insert(table).values({ type: "rolled-back" });
            tx.rollback();
          }),
        ),
      ).rejects.toThrow("Rollback");
      await singleDb.insert(table).values({ type: "after-rollback" });
      expect(
        await singleDb
          .select({ type: table.type })
          .from(table)
          .where(eq(table.type, "rolled-back")),
      ).toEqual([]);
      expect(await history("rolled-back")).toEqual([]);
      expect(await history("committed")).toEqual([
        { op: "I", changed_by: 54, changed_via: "committed" },
      ]);
      expect(await history("after-commit")).toEqual([
        { op: "I", changed_by: null, changed_via: null },
      ]);
      expect(await history("after-rollback")).toEqual([
        { op: "I", changed_by: null, changed_via: null },
      ]);
      const [last] = await single<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      expect(first?.pid).toEqual(expect.any(Number));
      expect(last?.pid).toBe(first?.pid);
    } finally {
      await single.end();
    }
  });

  it("isolates 200 writes by 50 users over two pooled connections with complete NULL-safe verification", async () => {
    await Promise.all(
      Array.from({ length: 200 }, (_, index) => {
        const userId = (index % 50) + 1;
        return runWithAuditContext({ userId, source: `u${userId}` }, async () =>
          db.insert(table).values({
            type: `concurrent-${index}`,
            description: String(userId),
          }),
        );
      }),
    );
    const [result] = await client<
      { count: number; distinct_writes: number; mismatches: number }[]
    >`
      select count(*)::int as count,
        count(distinct new_row->>'type')::int as distinct_writes,
        count(*) filter (where
          changed_by is distinct from (new_row->>'description')::int
          or changed_via is distinct from 'u' || (new_row->>'description'))::int as mismatches
      from public_history.attendance_types where new_row->>'type' like 'concurrent-%'`;
    expect(result).toEqual({ count: 200, distinct_writes: 200, mismatches: 0 });
    const [source] = await client<
      { count: number }[]
    >`select count(*)::int as count from attendance_types where type like 'concurrent-%'`;
    expect(source).toEqual({ count: 200 });
  });

  it("sends no BEGIN or settings for reads and inactive writes", async () => {
    await client`select 1`;
    statements.length = 0;
    await runWithAuditContext(actor, () =>
      db.select({ type: table.type }).from(table).limit(1),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^select /i);
    statements.length = 0;
    await runWithAuditContext({ userId: null, source: null }, async () =>
      db.insert(table).values({ type: "inactive" }),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^insert /i);
    expect(await history("inactive")).toEqual([
      { op: "I", changed_by: null, changed_via: null },
    ]);
  });

  it("rejects invalid context before any statement including BEGIN", async () => {
    statements.length = 0;
    for (const context of [
      { userId: 2147483648, source: null },
      { userId: 4, source: "api\n" },
    ]) {
      await expect(
        runWithAuditContext(context, async () =>
          db.insert(table).values({ type: "invalid" }),
        ),
      ).rejects.toThrow();
      expect(() =>
        runWithAuditContext(context, () =>
          db.transaction(() => Promise.resolve(1)),
        ),
      ).toThrow(/Invalid audit/);
    }
    expect(statements).toEqual([]);
    expect(await history("invalid")).toEqual([]);
  });

  it("keeps builders lazy and supports returning a builder from an async context callback", async () => {
    statements.length = 0;
    await runWithAuditContext(actor, async () => {
      const builder = db
        .insert(table)
        .values({ type: "lazy" })
        .returning({ type: table.type });
      expect(statements).toEqual([]);
      return builder;
    });
    expect(await history("lazy")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
  });

  it("executes a native lazy query once across values and then consumers", async () => {
    statements.length = 0;
    await runWithAuditContext(actor, async () => {
      const query = client.unsafe(
        "insert into attendance_types(type) values ('native-once') returning type",
      );
      const values = query.values();
      expect(statements).toEqual([]);
      expect([...(await values)]).toEqual([["native-once"]]);
      expect([...(await query)]).toEqual([["native-once"]]);
      expect([...(await values)]).toEqual([["native-once"]]);
    });
    expect(
      statements.filter((statement) => /^insert /i.test(statement)),
    ).toHaveLength(1);
    expect(statements.at(-1)).toBe("commit");
    expect(await history("native-once")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
  });

  it("memoizes a rejected native write without retrying it", async () => {
    statements.length = 0;
    await runWithAuditContext(actor, async () => {
      const query = client.unsafe(
        "insert into attendance_types(type) values (null)",
      );
      await expect(query).rejects.toMatchObject({ code: "23502" });
      await expect(query.values()).rejects.toMatchObject({ code: "23502" });
    });
    expect(
      statements.filter((statement) => /^insert /i.test(statement)),
    ).toHaveLength(1);
    expect(statements.at(-1)).toBe("rollback");
  });

  it("preserves native begin options and immediate array callback execution", async () => {
    const result = await runWithAuditContext(actor, () =>
      client.begin(
        "isolation level serializable read write deferrable",
        (tx) => [
          tx.unsafe(
            "insert into attendance_types(type) values ('native-array') returning type",
          ),
          tx.unsafe(
            "select current_setting('transaction_isolation') as isolation, current_setting('transaction_deferrable') as deferrable",
          ),
        ],
      ),
    );
    expect(result.map((rows) => [...rows])).toEqual([
      [{ type: "native-array" }],
      [{ isolation: "serializable", deferrable: "on" }],
    ]);
    expect(await history("native-array")).toEqual([
      { op: "I", changed_by: 41, changed_via: null },
    ]);
  });

  it("composes with query timeouts while BEGIN and transaction writes retain native execution", async () => {
    const bounded = postgres(owned.url, { max: 1, prepare: false });
    withQueryTimeout(bounded, 30);
    withAuditContext(bounded);
    try {
      await bounded`select 1`;
      await expect(
        runWithAuditContext(actor, async () =>
          bounded.unsafe("select pg_sleep(0.2)"),
        ),
      ).rejects.toThrow(/pool-wait\/execution timeout/);
      await runWithAuditContext(actor, async () =>
        bounded.unsafe(
          "insert into attendance_types(type) select 'timeout-composition' from pg_sleep(0.1)",
        ),
      );
      expect(await history("timeout-composition")).toEqual([
        { op: "I", changed_by: 41, changed_via: null },
      ]);
    } finally {
      await bounded.end();
    }
  });
});
