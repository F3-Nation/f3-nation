import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POSITIONS } from "./data";
import { seedPositions } from "./positions";

interface PositionRow {
  id: number;
  name: string;
  orgId: number | null;
  orgType: string | null;
}

/** The id a `where(eq(positions.id, …))` condition targets. */
const targetId = (cond: unknown) =>
  new PgDialect().sqlToQuery(cond as SQL).params[0];

/**
 * A db whose selects return the given rows for each position name, and whose
 * writes are recorded.
 */
const fakeDb = (rowsByName: Record<string, PositionRow[]>) => {
  const names = POSITIONS.map((p) => p.name);
  let selectCall = 0;
  const updates: { set: Record<string, unknown>; id: unknown }[] = [];
  const deletes: unknown[] = [];
  const inserts: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const name = names[selectCall++];
          return Promise.resolve(name ? (rowsByName[name] ?? []) : []);
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          updates.push({ set, id: targetId(cond) });
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => {
        deletes.push(targetId(cond));
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db: db as never, updates, deletes, inserts };
};

const siteQ = POSITIONS.find((p) => p.name === "Site Q")!;
const global = (id: number, orgType: string): PositionRow => ({
  id,
  name: siteQ.name,
  orgId: null,
  orgType,
});
const orgDefined = (id: number): PositionRow => ({
  id,
  name: siteQ.name,
  orgId: 99,
  orgType: "region",
});

describe("seedPositions", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds Site Q on AOs", () => {
    expect(siteQ.orgType).toBe("ao");
  });

  it("inserts each missing position as global with its own org type", async () => {
    const { db, inserts, updates, deletes } = fakeDb({});
    await seedPositions(db);
    expect(
      inserts.map(({ name, orgId, orgType }) => [name, orgId, orgType]),
    ).toEqual(POSITIONS.map((p) => [p.name, null, p.orgType]));
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("corrects the org type of a position's only global row", async () => {
    const { db, inserts, updates } = fakeDb({
      [siteQ.name]: [global(6, "region")],
    });
    await seedPositions(db);
    expect(updates).toEqual([{ set: { orgType: "ao" }, id: 6 }]);
    expect(inserts.map((v) => v.name)).not.toContain(siteQ.name);
  });

  it("leaves a global row whose org type already matches", async () => {
    const { db, updates } = fakeDb({ [siteQ.name]: [global(6, "ao")] });
    await seedPositions(db);
    expect(updates).toEqual([]);
  });

  it("leaves a position the nation defines once per org type alone", async () => {
    const { db, updates, inserts } = fakeDb({
      [siteQ.name]: [global(5, "region"), global(6, "sector")],
    });
    await seedPositions(db);
    expect(updates).toEqual([]);
    expect(inserts.map((v) => v.name)).not.toContain(siteQ.name);
  });

  it("deletes org-defined duplicates of a position that has a global row", async () => {
    const { db, deletes } = fakeDb({
      [siteQ.name]: [global(6, "ao"), orgDefined(46), orgDefined(47)],
    });
    await seedPositions(db);
    expect(deletes).toEqual([46, 47]);
  });

  it("turns the first org-defined row into the global one with the position's org type", async () => {
    const { db, updates, deletes, inserts } = fakeDb({
      [siteQ.name]: [orgDefined(46), orgDefined(47)],
    });
    await seedPositions(db);
    expect(updates).toEqual([{ set: { orgId: null, orgType: "ao" }, id: 46 }]);
    expect(deletes).toEqual([47]);
    expect(inserts.map((v) => v.name)).not.toContain(siteQ.name);
  });
});
