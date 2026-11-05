import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { integer, pgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import {
  auditContext,
  auditSettingsSql,
  runWithAuditContext,
  toAuditUserId,
  withAuditContext,
} from "./audit-context";

function recordingClient() {
  const calls: unknown[][] = [];
  const pending = Object.assign(Promise.resolve([{ id: 7 }]), {
    values: () => Promise.resolve([[7]]),
  });
  const tx = {
    unsafe: (...args: unknown[]) => {
      calls.push(["tx", ...args]);
      return pending;
    },
    savepoint: async (callback: (client: unknown) => unknown) => {
      calls.push(["savepoint"]);
      return await callback(tx);
    },
  };
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: (...args: unknown[]) => {
      calls.push(["unsafe", ...args]);
      return pending;
    },
    begin: async (...args: unknown[]) => {
      calls.push(["begin", ...args.slice(0, -1)]);
      const callback = args.at(-1) as (sql: typeof tx) => unknown;
      const result = callback(tx);
      const resolved = await (Array.isArray(result)
        ? Promise.all(result)
        : result);
      calls.push(["commit"]);
      return resolved;
    },
  } as unknown as postgres.Sql;
  withAuditContext(client);
  return { client, calls, pending };
}

const store = { userId: 42, source: "web-1" };
const settings = "set local app.user_id = '42'; set local app.source = 'web-1'";
const probe = pgTable("audit_probe", { id: integer("id") });

describe("installed Drizzle adapter contract", () => {
  it("keeps a returning write lazy and maps unsafe values after commit", async () => {
    const { client, calls } = recordingClient();
    const db = drizzle(client);
    await runWithAuditContext(store, async () => {
      const query = db.insert(probe).values({ id: 7 }).returning();
      expect(calls).toEqual([]);
      expect(await query).toEqual([{ id: 7 }]);
    });
    expect(calls).toEqual([
      ["begin"],
      ["tx", settings],
      [
        "tx",
        'insert into "audit_probe" ("id") values ($1) returning "id"',
        [7],
        { prepare: false },
      ],
      ["commit"],
    ]);
  });

  it("routes raw execute through attributed unsafe without values mapping", async () => {
    const { client, calls } = recordingClient();
    const db = drizzle(client);
    expect(
      await runWithAuditContext(store, async () =>
        db.execute(sql`update "audit_probe" set "id" = ${7}`),
      ),
    ).toEqual([{ id: 7 }]);
    expect(calls).toEqual([
      ["begin"],
      ["tx", settings],
      ["tx", 'update "audit_probe" set "id" = $1', [7], { prepare: false }],
      ["commit"],
    ]);
  });

  it("routes transaction options and nested savepoints through the attributed client", async () => {
    const { client, calls } = recordingClient();
    const db = drizzle(client);
    expect(
      await runWithAuditContext(store, () =>
        db.transaction(
          (tx) =>
            tx.transaction((nested) =>
              nested.insert(probe).values({ id: 7 }).returning(),
            ),
          { isolationLevel: "serializable", deferrable: true },
        ),
      ),
    ).toEqual([{ id: 7 }]);
    expect(calls).toEqual([
      ["begin"],
      ["tx", settings],
      [
        "tx",
        "set transaction isolation level serializable deferrable",
        [],
        { prepare: false },
      ],
      ["savepoint"],
      [
        "tx",
        'insert into "audit_probe" ("id") values ($1) returning "id"',
        [7],
        { prepare: false },
      ],
      ["commit"],
    ]);
  });
});

describe("audit actor normalization", () => {
  it.each([
    [1, 1],
    ["42", 42],
    [2147483647, 2147483647],
    ["2147483647", 2147483647],
    [null, null],
    [undefined, null],
    ["", null],
    ["invalid", null],
    [0, null],
    [-1, null],
    [1.2, null],
    [NaN, null],
    [Infinity, null],
    [2147483648, null],
  ])("normalizes %s to %s", (value, expected) => {
    expect(toAuditUserId(value)).toBe(expected);
  });
});

describe("audit settings", () => {
  it.each([
    [store, settings],
    [
      { userId: null, source: null },
      "set local app.user_id = ''; set local app.source = ''",
    ],
    [
      { userId: 2147483647, source: "" },
      "set local app.user_id = '2147483647'; set local app.source = ''",
    ],
    [
      { userId: null, source: "u1" },
      "set local app.user_id = ''; set local app.source = 'u1'",
    ],
  ])(
    "builds validated transaction-local settings for %j",
    (context, expected) => {
      expect(auditSettingsSql(context)).toBe(expected);
    },
  );

  it.each([
    0,
    -1,
    1.2,
    NaN,
    Infinity,
    2147483648,
    "1",
    undefined,
    Symbol("invalid"),
  ])("rejects invalid actor %s before any statement", async (userId) => {
    const { client, calls } = recordingClient();
    const invalid = { userId, source: null } as unknown as typeof store;
    expect(() => auditSettingsSql(invalid)).toThrow(/^Invalid audit user id$/);
    await expect(
      runWithAuditContext(invalid, async () =>
        client.unsafe("insert into x values (1)"),
      ),
    ).rejects.toThrow(/^Invalid audit user id$/);
    await expect(
      runWithAuditContext(invalid, async () => client.begin(() => 1)),
    ).rejects.toThrow(/^Invalid audit user id$/);
    expect(calls).toEqual([]);
  });

  it.each([
    "a\n",
    "a\r",
    "A",
    "with space",
    "a'",
    "a;",
    "é",
    "a\0",
    2,
    undefined,
  ])("rejects invalid source %j before any statement", async (source) => {
    const { client, calls } = recordingClient();
    const invalid = { userId: null, source } as unknown as typeof store;
    expect(() => auditSettingsSql(invalid)).toThrow(/^Invalid audit source$/);
    await expect(
      runWithAuditContext(invalid, async () =>
        client.unsafe("update x set a=1"),
      ),
    ).rejects.toThrow(/^Invalid audit source$/);
    await expect(
      runWithAuditContext(invalid, async () => client.begin(() => 1)),
    ).rejects.toThrow(/^Invalid audit source$/);
    expect(calls).toEqual([]);
  });
});

describe("audit client boundaries", () => {
  it.each([
    [{ userId: 0, source: null }, "Invalid audit user id"],
    [{ userId: null, source: "bad'input" }, "Invalid audit source"],
  ])(
    "rejects native begin through its Promise before any SQL for %j",
    async (context, message) => {
      const { client, calls } = recordingClient();
      const callback = () => {
        throw new Error("callback must not run");
      };
      const rejected = runWithAuditContext(context, () =>
        client.begin(callback),
      );
      expect(rejected).toBeInstanceOf(Promise);
      const error: unknown = await rejected.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message });
      const withOptions = runWithAuditContext(context, () =>
        client.begin("read only", callback),
      );
      await expect(withOptions).rejects.toMatchObject({ message });
      expect(calls).toEqual([]);
    },
  );

  it("validates active context before read and driver bypasses send any SQL", () => {
    const { client, calls } = recordingClient();
    runWithAuditContext({ userId: 0, source: null }, () => {
      expect(() => client.unsafe("select 1")).toThrow(
        /^Invalid audit user id$/,
      );
      const options = { onexecute: () => undefined, prepare: false };
      expect(() => client.unsafe("begin", [], options)).toThrow(
        /^Invalid audit user id$/,
      );
    });
    expect(calls).toEqual([]);
  });

  it.each(["select 'update' as label", "with x as (select 1) select * from x"])(
    "passes through read %s with exact arguments",
    (statement) => {
      const { client, calls, pending } = recordingClient();
      const parameters = [7];
      const options = { prepare: false };
      expect(
        runWithAuditContext(store, () =>
          client.unsafe(statement, parameters, options),
        ),
      ).toBe(pending);
      expect(calls).toEqual([["unsafe", statement, parameters, options]]);
      expect(calls[0]![2]).toBe(parameters);
      expect(calls[0]![3]).toBe(options);
    },
  );

  it("routes a WITH read containing a write keyword through the heuristic transaction", async () => {
    const { client, calls } = recordingClient();
    const statement = "with x as (select 'update' as label) select * from x";
    await runWithAuditContext(store, () => client.unsafe(statement));
    expect(calls).toEqual([
      ["begin"],
      ["tx", settings],
      ["tx", statement],
      ["commit"],
    ]);
  });

  it("passes through inactive queries and native transaction options", async () => {
    const { client, calls, pending } = recordingClient();
    expect(client.unsafe("update x set a=1")).toBe(pending);
    runWithAuditContext({ userId: null, source: null }, () => {
      expect(client.unsafe("delete from x")).toBe(pending);
    });
    expect(await client.begin("read only", () => 9)).toBe(9);
    expect(
      await runWithAuditContext({ userId: null, source: null }, () =>
        client.begin(() => 10),
      ),
    ).toBe(10);
    expect(calls).toEqual([
      ["unsafe", "update x set a=1"],
      ["unsafe", "delete from x"],
      ["begin", "read only"],
      ["commit"],
      ["begin"],
      ["commit"],
    ]);
  });

  it("passes through reads and driver onexecute queries in context", () => {
    const { client, calls, pending } = recordingClient();
    runWithAuditContext(store, () => {
      expect(client.unsafe("select 1")).toBe(pending);
      const options = { onexecute: () => undefined, prepare: false };
      expect(client.unsafe("insert into x values (1)", [], options)).toBe(
        pending,
      );
    });
    expect(calls.map((call) => call[0])).toEqual(["unsafe", "unsafe"]);
  });

  it.each([
    "insert into x values ($1)",
    " UPDATE x SET a=$1",
    "delete from x where a=$1",
    "merge into x using y on true when matched then delete",
    "with x as (select 1) insert into y values ($1)",
  ])("wraps recognized write %s lazily and only once", async (sql) => {
    const { client, calls } = recordingClient();
    await runWithAuditContext(store, async () => {
      const query = client.unsafe(sql, [7]);
      const values = query.values();
      expect(calls).toEqual([]);
      expect(await values).toEqual([[7]]);
      expect(await values).toEqual([[7]]);
      expect(await query).toEqual([[7]]);
    });
    expect(calls).toEqual([
      ["begin"],
      ["tx", settings],
      ["tx", sql, [7]],
      ["commit"],
    ]);
  });

  it("shares one execution when then is consumed before values", async () => {
    const { client, calls } = recordingClient();
    await runWithAuditContext(store, async () => {
      const query = client.unsafe("insert into x values (1)");
      expect(await query).toEqual([{ id: 7 }]);
      expect(await query.values()).toEqual([{ id: 7 }]);
    });
    expect(calls.filter((call) => call[0] === "begin")).toHaveLength(1);
    expect(calls.at(-1)).toEqual(["commit"]);
  });

  it("keeps the result mode chosen by the first consumer during overlapping consumption", async () => {
    const { client, calls } = recordingClient();
    await runWithAuditContext(store, async () => {
      const query = client.unsafe("insert into x values (1)");
      const first = query.then((rows) => rows);
      const second = query.values().then((rows) => rows);
      expect(await Promise.all([first, second])).toEqual([
        [{ id: 7 }],
        [{ id: 7 }],
      ]);
    });
    expect(calls.filter((call) => call[0] === "begin")).toHaveLength(1);
  });

  it("preserves options and resolves native immediate-array callback results", async () => {
    const { client, calls } = recordingClient();
    const result = await runWithAuditContext(store, () =>
      client.begin(
        "isolation level serializable read write deferrable",
        (tx) => [
          tx.unsafe("insert into x values (1)"),
          tx.unsafe("insert into x values (2)"),
        ],
      ),
    );
    expect(result).toEqual([[{ id: 7 }], [{ id: 7 }]]);
    expect(calls).toEqual([
      ["begin", "isolation level serializable read write deferrable"],
      ["tx", settings],
      ["tx", "insert into x values (1)"],
      ["tx", "insert into x values (2)"],
      ["commit"],
    ]);
  });

  it("restores context and allows explicitly detached work", async () => {
    expect(auditContext.getStore()).toBeUndefined();
    expect(runWithAuditContext(store, () => 17)).toBe(17);
    await runWithAuditContext(store, async () => {
      await Promise.resolve();
      expect(auditContext.getStore()).toEqual(store);
      expect(auditContext.exit(() => auditContext.getStore())).toBeUndefined();
    });
    expect(auditContext.getStore()).toBeUndefined();
  });
});
