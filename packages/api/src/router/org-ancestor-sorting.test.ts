import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq, schema, sql } from "@acme/db";

const mockLimit = vi.hoisted(() => vi.fn());
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { createTestClient, db, uniqueId } from "../__tests__/test-utils";
import { orgAncestorName } from "../org-ancestor-name";
import { ORG_TREE_MAX_DEPTH } from "../org-tree";
import { createOrgTree } from "../testing/org-tree";

describe("organization ancestor sorting", () => {
  const tree = createOrgTree();
  const prefix = `AncestorSort-${uniqueId()}`;
  const areas: number[] = [];
  let alphaSector: number;
  let zuluSector: number;

  beforeEach(() => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60000,
    });
  });

  beforeAll(async () => {
    alphaSector = (await tree.create({ orgType: "sector", name: "Alpha" })).id;
    zuluSector = (await tree.create({ orgType: "sector", name: "Zulu" })).id;
    const alphaTerritory = await tree.create({
      orgType: "territory",
      name: "Alpha",
      parentId: zuluSector,
    });
    const zuluTerritory = await tree.create({
      orgType: "territory",
      name: "Zulu",
      parentId: alphaSector,
      isActive: false,
    });
    for (const [index, parentId] of [
      zuluSector,
      zuluTerritory.id,
      alphaSector,
      alphaTerritory.id,
      null,
      zuluTerritory.id,
    ].entries()) {
      areas.push(
        (
          await tree.create({
            orgType: "area",
            name: `${prefix} ${index}`,
            parentId,
          })
        ).id,
      );
    }
  });

  afterAll(async () => tree.cleanup());

  it.each([
    { id: "sectorName", desc: false, order: [1, 2, 5, 0, 3, 4] },
    { id: "sectorName", desc: true, order: [0, 3, 1, 2, 5, 4] },
    { id: "territoryName", desc: false, order: [3, 1, 5, 0, 2, 4] },
    { id: "territoryName", desc: true, order: [1, 5, 3, 0, 2, 4] },
  ])(
    "sorts $id desc=$desc before paging with stable ties and missing names last",
    async ({ id, desc, order }) => {
      const client = createTestClient();
      const input = {
        orgTypes: ["area"] as const,
        searchTerm: prefix,
        sorting: [{ id, desc }],
      };
      const expected = order.map((index) => areas[index]);
      const all = await client.org.all({ ...input, orgTypes: ["area"] });
      expect(all.orgs.map((org) => org.id)).toEqual(expected);
      expect(all.total).toBe(6);
      const paged: number[] = [];
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const page = await client.org.all({
          ...input,
          orgTypes: ["area"],
          pageIndex,
          pageSize: 2,
        });
        expect(page.total).toBe(6);
        paged.push(...page.orgs.map((org) => org.id));
      }
      expect(paged).toEqual(expected);
    },
  );

  it("preserves explicit secondary sorts and parent filters", async () => {
    const result = await createTestClient().org.all({
      orgTypes: ["area"],
      searchTerm: prefix,
      sorting: [
        { id: "sectorName", desc: false },
        { id: "id", desc: true },
      ],
    });
    expect(result.orgs.map((org) => org.id)).toEqual([
      areas[5],
      areas[2],
      areas[1],
      areas[3],
      areas[0],
      areas[4],
    ]);
    const filtered = await createTestClient().org.all({
      orgTypes: ["area"],
      searchTerm: prefix,
      parentOrgIds: [zuluSector, alphaSector],
      sorting: [{ id: "sectorName", desc: false }],
    });
    expect(filtered.orgs.map((org) => org.id)).toEqual([areas[2], areas[0]]);
    expect(filtered.total).toBe(2);
  });

  it("sorts both ancestor keys in request order before the ID tie-break", async () => {
    const result = await createTestClient().org.all({
      orgTypes: ["area"],
      searchTerm: prefix,
      sorting: [
        { id: "sectorName", desc: false },
        { id: "territoryName", desc: true },
      ],
    });
    expect(result.orgs.map((org) => org.id)).toEqual([
      areas[1],
      areas[5],
      areas[2],
      areas[3],
      areas[0],
      areas[4],
    ]);
  });

  it.each([
    undefined,
    ["ao"],
    ["region"],
    ["area", "ao"],
    ["area", "area"],
  ] as const)(
    "rejects ancestor sorting outside an exclusively Area request: %j",
    async (orgTypes) => {
      for (const id of ["sectorName", "territoryName"]) {
        await expect(
          createTestClient().org.all({
            ...(orgTypes ? { orgTypes: [...orgTypes] } : {}),
            sorting: [{ id, desc: false }],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    },
  );

  it("keeps ID ties stable across pages independently of physical order", async () => {
    const tied: number[] = [];
    const parent = (await tree.get(areas[1]!)).parentId;
    try {
      for (let i = 0; i < 40; i++) {
        tied.push(
          (
            await tree.create({
              orgType: "area",
              name: `${prefix}-ties ${i}`,
              parentId: parent,
            })
          ).id,
        );
      }
      // Fixture-only UPDATE moves the first tuple after its tied peers.
      await db
        .update(schema.orgs)
        .set({ name: sql`${schema.orgs.name}` })
        .where(eq(schema.orgs.id, tied[0]!));
      const paged: number[] = [];
      for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
        const result = await createTestClient().org.all({
          orgTypes: ["area"],
          searchTerm: `${prefix}-ties`,
          sorting: [{ id: "territoryName", desc: true }],
          pageIndex,
          pageSize: 5,
        });
        paged.push(...result.orgs.map((org) => org.id));
      }
      expect(paged).toEqual(tied);
    } finally {
      for (const id of tied) await tree.remove(id);
    }
  });

  it("keeps existing direct-parent sorting distinct from ancestor sorting", async () => {
    const result = await createTestClient().org.all({
      orgTypes: ["area"],
      searchTerm: prefix,
      sorting: [
        { id: "parentOrgName", desc: false },
        { id: "id", desc: false },
      ],
    });
    expect(result.orgs.map((org) => org.id)).toEqual([
      areas[2],
      areas[3],
      areas[0],
      areas[1],
      areas[5],
      areas[4],
    ]);
  });

  const ancestorNames = async (id: number) => {
    const [row] = await db
      .select({
        sector: orgAncestorName(schema.orgs.id, "sector"),
        territory: orgAncestorName(schema.orgs.id, "territory"),
      })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, id));
    return row;
  };

  it("uses the nearest matching ancestor and terminates cycles without matching self", async () => {
    const near = await tree.create({
      orgType: "sector",
      name: "Near",
      parentId: alphaSector,
    });
    const area = await tree.create({ orgType: "area", parentId: near.id });
    expect(await ancestorNames(area.id)).toEqual({
      sector: "Near",
      territory: null,
    });
    await tree.move(near.id, area.id);
    expect(await ancestorNames(area.id)).toEqual({
      sector: "Near",
      territory: null,
    });
    expect(await ancestorNames(near.id)).toEqual({
      sector: null,
      territory: null,
    });
  });

  it("finds a match at the depth boundary but not beyond it", async () => {
    const chain = await tree.chain(
      Array.from({ length: ORG_TREE_MAX_DEPTH }, () => "area" as const),
      { parentId: alphaSector },
    );
    const boundary = chain.at(-1)!;
    const beyond = await tree.create({
      orgType: "area",
      parentId: boundary.id,
    });
    expect(await ancestorNames(boundary.id)).toEqual({
      sector: "Alpha",
      territory: null,
    });
    expect(await ancestorNames(beyond.id)).toEqual({
      sector: null,
      territory: null,
    });
  });
});
