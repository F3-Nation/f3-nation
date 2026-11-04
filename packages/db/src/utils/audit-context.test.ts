import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  auditContext,
  auditSettingsSql,
  runWithAuditContext,
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
  };
  const client = {
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

  it.each([0, -1, 1.2, NaN, Infinity, 2147483648, "1", undefined])(
    "rejects invalid actor %s before any statement",
    async (userId) => {
      const { client, calls } = recordingClient();
      const invalid = { userId, source: null } as unknown as typeof store;
      expect(() => auditSettingsSql(invalid)).toThrow(/audit/i);
      await expect(
        runWithAuditContext(invalid, async () =>
          client.unsafe("insert into x values (1)"),
        ),
      ).rejects.toThrow(/audit/i);
      await expect(
        runWithAuditContext(invalid, async () => client.begin(() => 1)),
      ).rejects.toThrow(/audit/i);
      expect(calls).toEqual([]);
    },
  );

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
    expect(() => auditSettingsSql(invalid)).toThrow(/audit/i);
    await expect(
      runWithAuditContext(invalid, async () =>
        client.unsafe("update x set a=1"),
      ),
    ).rejects.toThrow(/audit/i);
    await expect(
      runWithAuditContext(invalid, async () => client.begin(() => 1)),
    ).rejects.toThrow(/audit/i);
    expect(calls).toEqual([]);
  });
});

describe("audit client boundaries", () => {
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
