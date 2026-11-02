import type { Session } from "@acme/auth";
import { eq, schema, sql, withAuditUser } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { env } from "@acme/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withAuditContext } from "../lib/with-audit-context";
import { cleanup, createAdminSession, db, uniqueId } from "./test-utils";

describe("transaction-local audit context", () => {
  const locationIds: number[] = [];
  let orgId: number;

  beforeAll(async () => {
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Audit context ${uniqueId()}`,
        orgType: "region",
        isActive: true,
      })
      .returning();
    if (!org) throw new Error("Missing synthetic organization");
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of locationIds) await cleanup.location(id);
    await cleanup.org(orgId);
  });

  const insertLocation = async (
    client: AppDb,
    name = "Audit context location",
  ) => {
    const [location] = await client
      .insert(schema.locations)
      .values({
        name,
        orgId,
        isActive: true,
      })
      .returning();
    if (!location) throw new Error("Missing synthetic location");
    locationIds.push(location.id);
    return location.id;
  };

  const history = (client: AppDb, id: number) =>
    client.execute(sql`
    SELECT op, changed_by, changed_via FROM public_history.locations
    WHERE row_id = ${String(id)} ORDER BY id
  `);

  it("persists actor and source for source writes and nested savepoints, returning the callback value", async () => {
    const id = await withAuditUser(
      db,
      { userId: 23, source: "integration-test" },
      async (tx) => {
        const id = await insertLocation(tx);
        await tx.transaction(async (nested) => {
          await nested
            .update(schema.locations)
            .set({ name: "Nested change" })
            .where(eq(schema.locations.id, id));
        });
        return id;
      },
    );
    expect(await history(db, id)).toEqual([
      { op: "I", changed_by: 23, changed_via: "integration-test" },
      { op: "U", changed_by: 23, changed_via: "integration-test" },
    ]);
  });

  it("rolls back both source and history when the callback rejects", async () => {
    let id = 0;
    const failure = new Error("Synthetic write failure");
    await expect(
      withAuditUser(db, { userId: 24 }, async (tx) => {
        id = await insertLocation(tx);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      await db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, id)),
    ).toEqual([]);
    expect(await history(db, id)).toEqual([]);
  });

  it.each([false, true])(
    "clears actor and source on the same pooled connection after rollback=%s",
    async (rollback) => {
      const connection = postgres(env.TEST_DATABASE_URL!, {
        max: 1,
        prepare: false,
      });
      const single = drizzle(connection, { schema });
      try {
        const [before] = await connection`SELECT pg_backend_pid() AS pid`;
        const failure = new Error("Synthetic rollback");
        const transaction = withAuditUser(
          single,
          { userId: 25, source: "temporary-source" },
          async (tx) => {
            const id = await insertLocation(tx);
            expect(await history(tx, id)).toEqual([
              { op: "I", changed_by: 25, changed_via: "temporary-source" },
            ]);
            if (rollback) throw failure;
          },
        );
        if (rollback) await expect(transaction).rejects.toBe(failure);
        else await transaction;
        const id = await insertLocation(single);
        expect(await history(single, id)).toEqual([
          { op: "I", changed_by: null, changed_via: null },
        ]);
        const [after] = await connection`SELECT pg_backend_pid() AS pid`;
        expect(after?.pid).toBe(before?.pid);
      } finally {
        await connection.end();
      }
    },
  );

  it("clears pre-existing connection settings when no actor or source is supplied", async () => {
    const connection = postgres(env.TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
    });
    const single = drizzle(connection, { schema });
    try {
      await connection`SELECT set_config('app.user_id', '26', false), set_config('app.source', 'stale', false)`;
      const id = await withAuditUser(single, { userId: null }, insertLocation);
      expect(await history(single, id)).toEqual([
        { op: "I", changed_by: null, changed_via: null },
      ]);
    } finally {
      await connection.end();
    }
  });

  it("keeps concurrent callers' actors and sources separate", async () => {
    const connection = postgres(env.TEST_DATABASE_URL!, {
      max: 2,
      prepare: false,
    });
    const concurrent = drizzle(connection, { schema });
    let release!: () => void;
    let entered = 0;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let timeout!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Concurrent transactions did not finish")),
        5000,
      );
    });
    const insertConcurrently = (userId: number, source: string) =>
      withAuditUser(concurrent, { userId, source }, async (tx) => {
        const [backend] = await tx.execute<{ pid: number }>(
          sql`SELECT pg_backend_pid() AS pid`,
        );
        if (++entered === 2) release();
        await bothStarted;
        return { id: await insertLocation(tx), pid: backend?.pid };
      });
    try {
      const rows = await Promise.race([
        Promise.all([
          insertConcurrently(27, "first"),
          insertConcurrently(28, "second"),
        ]),
        deadline,
      ]);
      expect(rows[0].pid).toBeTypeOf("number");
      expect(rows[1].pid).toBeTypeOf("number");
      expect(rows[0].pid).not.toBe(rows[1].pid);
      expect(await history(concurrent, rows[0].id)).toEqual([
        { op: "I", changed_by: 27, changed_via: "first" },
      ]);
      expect(await history(concurrent, rows[1].id)).toEqual([
        { op: "I", changed_by: 28, changed_via: "second" },
      ]);
    } finally {
      clearTimeout(timeout);
      release();
      await connection.end({ timeout: 5 });
    }
  }, 15000);

  it.each([
    { id: "29", actor: 29 },
    { id: 0, actor: null },
    { id: -1, actor: null },
    { id: 1.5, actor: null },
    { id: "not-an-id", actor: null },
    { id: undefined, actor: null },
    { id: 2147483648, actor: null },
  ])(
    "normalizes session id=$id to actor=$actor without using nested user id",
    async ({ id, actor }) => {
      const session = { ...(await createAdminSession()), id } as Session;
      const locationId = await withAuditContext(
        { db, session },
        async ({ db: tx, session: copiedSession }) => {
          expect(copiedSession).toBe(session);
          return insertLocation(tx);
        },
      );
      expect(await history(db, locationId)).toEqual([
        { op: "I", changed_by: actor, changed_via: null },
      ]);
    },
  );

  it("leaves anonymous writes without a human actor", async () => {
    const id = await withAuditContext({ db, session: null }, ({ db: tx }) =>
      insertLocation(tx),
    );
    expect(await history(db, id)).toEqual([
      { op: "I", changed_by: null, changed_via: null },
    ]);
  });
});
