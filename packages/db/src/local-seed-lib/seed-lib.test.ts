import { describe, expect, it, vi } from "vitest";

import { LOCAL_API_KEYS } from "./data";
import { resetAllSequences } from "./sequences";
import { seedApiKeys } from "./users";

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
