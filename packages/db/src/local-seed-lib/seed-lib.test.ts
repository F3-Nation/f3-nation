import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_API_KEYS, LOCAL_OAUTH_CLIENTS } from "./data";
import { resetAllSequences, resetSequences } from "./sequences";
import { seedApiKeys, seedDevUsers, seedOAuthClients } from "./users";

describe("resetAllSequences", () => {
  it("sets each owned sequence and skips columns without one", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        { seq: "public.orgs_id_seq", table_name: "orgs", column_name: "id" },
        { seq: null, table_name: "orgs", column_name: "name" },
        { seq: "public.users_id_seq", table_name: "users", column_name: "id" },
      ])
      .mockResolvedValue([]);
    await expect(resetAllSequences({ execute } as never)).resolves.toBe(2);
    // One catalog query, then a setval per sequence.
    expect(execute).toHaveBeenCalledTimes(3);
    const setvals = execute.mock.calls
      .slice(1)
      .map(([q]) => new PgDialect().sqlToQuery(q as SQL));
    expect(setvals).toHaveLength(2);
    for (const [q, table] of [
      [setvals[0], "orgs"],
      [setvals[1], "users"],
    ] as const) {
      expect(q?.sql).toMatch(
        new RegExp(
          `setval\\(\\s*\\$1::regclass,\\s*coalesce\\(max\\("id"\\), 1\\),\\s*max\\("id"\\) IS NOT NULL\\s*\\) FROM "${table}"`,
        ),
      );
      expect(q?.params).toEqual([`public.${table}_id_seq`]);
    }
  });
});

describe("seedApiKeys", () => {
  const roleIds = { adminId: 1, editorId: 2 };
  const scoped = LOCAL_API_KEYS.filter((k) => k.regionName);

  // A db whose inserts record the keys they were given.
  const fakeDb = () => {
    const inserted: string[] = [];
    const chain = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      q.values = (v: { key?: string }) => {
        if (v.key) inserted.push(v.key);
        return q;
      };
      q.onConflictDoNothing = () => q;
      q.returning = () => Promise.resolve(rows);
      q.then = (res: (v: unknown) => void) => res(rows);
      return q;
    };
    return {
      inserted,
      db: { insert: () => chain([{ id: 7 }]) } as never,
    };
  };

  it("throws on a missing region by default", async () => {
    const { db } = fakeDb();
    await expect(seedApiKeys(db, 1, 1, roleIds, {})).rejects.toThrow(
      /unknown region/,
    );
  });

  it("skips region-scoped keys without inserting them when asked to", async () => {
    const { db, inserted } = fakeDb();
    const skipped = await seedApiKeys(
      db,
      1,
      1,
      roleIds,
      {},
      { skipMissingRegions: true },
    );
    expect(skipped).toEqual(scoped.map((k) => k.key));
    expect(inserted).not.toContain(scoped[0]?.key);
    expect(inserted).toContain("local-api-key");
  });

  it("seeds region-scoped keys when the region exists", async () => {
    const { db, inserted } = fakeDb();
    const skipped = await seedApiKeys(
      db,
      1,
      1,
      roleIds,
      { Boone: 5 },
      { skipMissingRegions: true },
    );
    expect(skipped).toEqual([]);
    expect(inserted).toContain("local-boone-editor-key");
  });
});

// A drizzle-like fake: every builder step returns the same thenable, and each
// `select()` resolves with the next queued result.
function fakeDb(selectResults: unknown[][] = []) {
  const queue = [...selectResults];
  const inserts: unknown[] = [];
  const conflictUpdates: unknown[] = [];
  const execute = vi.fn().mockResolvedValue([]);
  const chain = (rows: () => unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const step of ["from", "where", "limit", "onConflictDoNothing"]) {
      q[step] = () => q;
    }
    q.onConflictDoUpdate = (c: unknown) => {
      conflictUpdates.push(c);
      return q;
    };
    q.values = (v: unknown) => {
      inserts.push(v);
      return q;
    };
    q.returning = () => Promise.resolve([{ id: 1 }]);
    q.then = (res: (v: unknown) => void) => res(rows());
    return q;
  };
  const db = {
    select: () => chain(() => queue.shift() ?? []),
    insert: () => chain(() => []),
    execute,
  };
  return { db: db as never, inserts, conflictUpdates, execute };
}

describe("seedDevUsers", () => {
  const roles = [
    { id: 1, name: "admin" },
    { id: 2, name: "editor" },
  ];

  it("inserts missing roles, upserts each dev user and attaches roles", async () => {
    const { db, inserts } = fakeDb([
      [],
      roles,
      [{ id: 10 }],
      [{ id: 11 }],
      [{ id: 12 }],
    ]);
    const result = await seedDevUsers(db, 1);
    expect(result).toEqual({
      adminUserId: 10,
      roleIds: { adminId: 1, editorId: 2 },
    });
    // roles, 3 users, and a role link for the admin and the editor only.
    expect(inserts).toHaveLength(1 + 3 + 2);
  });

  it("skips role inserts when both exist and users that can't be read back", async () => {
    const { db, inserts } = fakeDb([roles, roles, [{ id: 10 }], [], []]);
    await seedDevUsers(db, 1);
    expect(inserts).toHaveLength(3 + 1);
  });

  it("throws when the roles are missing after the insert", async () => {
    const { db } = fakeDb([[], []]);
    await expect(seedDevUsers(db, 1)).rejects.toThrow(/Roles missing/);
  });

  it("throws when the admin dev user can't be found", async () => {
    const { db } = fakeDb([roles, roles, [], [], []]);
    await expect(seedDevUsers(db, 1)).rejects.toThrow(/Admin dev user missing/);
  });
});

describe("seedOAuthClients", () => {
  it("inserts every local OAuth client", async () => {
    const { db, inserts } = fakeDb();
    await seedOAuthClients(db);
    expect(inserts).toHaveLength(LOCAL_OAUTH_CLIENTS.length);
  });

  it("refreshes redirect URIs and origin when a client already exists", async () => {
    const { db, conflictUpdates } = fakeDb();
    await seedOAuthClients(db);
    expect(conflictUpdates).toHaveLength(LOCAL_OAUTH_CLIENTS.length);
    expect(conflictUpdates[0]).toMatchObject({
      set: {
        redirectUris: LOCAL_OAUTH_CLIENTS[0]?.redirectUris,
        allowedOrigin: LOCAL_OAUTH_CLIENTS[0]?.allowedOrigin,
      },
    });
  });
});

describe("resetSequences", () => {
  it("sets a sequence for each table that has rows", async () => {
    const { db, execute } = fakeDb(
      Array.from({ length: 7 }, () => [{ max: 5 }]),
    );
    await resetSequences(db);
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("leaves sequences alone for empty tables", async () => {
    const { db, execute } = fakeDb(
      Array.from({ length: 7 }, () => [{ max: 0 }]),
    );
    await resetSequences(db);
    expect(execute).not.toHaveBeenCalled();
  });
});
