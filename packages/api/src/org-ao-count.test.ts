import { eq, inArray, schema, sql } from "@acme/db";
import type { OrgType } from "@acme/shared/app/enums";
import { orgTypeRank } from "@acme/shared/app/org-hierarchy";
import { afterEach, describe, expect, it } from "vitest";

import { ORG_TREE_MAX_DEPTH } from "./org-tree";
import type { OrgTree, TreeOrg } from "./testing";
import { createOrgTree, db, getOrCreateF3NationOrg } from "./testing";

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Expected a value");
  return value;
};

const idArray = (ids: number[]) =>
  sql`ARRAY[${sql.join(ids, sql`, `)}]::integer[]`;

const recount = async (ids?: number[]) => {
  const rows = await db.execute<{ changed: number }>(
    ids
      ? sql`SELECT public.recount_org_ao_counts(${idArray(ids)}) AS changed`
      : sql`SELECT public.recount_org_ao_counts() AS changed`,
  );
  return Number(must(rows[0]).changed);
};

describe("org AO counts", () => {
  const trees: OrgTree[] = [];
  const newTree = () => {
    const tree = createOrgTree();
    trees.push(tree);
    return tree;
  };

  afterEach(async () => {
    await Promise.all(trees.splice(0).map((tree) => tree.cleanup()));
  });

  const countsOf = async (tree: OrgTree, named: Record<string, TreeOrg>) =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(named).map(
          async ([name, org]) => [name, await tree.aoCount(org.id)] as const,
        ),
      ),
    );

  describe("chains", () => {
    it("counts an AO in every count-carrying ancestor of a six-tier chain and leaves nation alone", async () => {
      const tree = newTree();
      const nation = await getOrCreateF3NationOrg();
      const nationBefore = (await tree.get(nation.id)).aoCount;

      const h = await tree.hierarchy({ parentId: nation.id });

      expect(
        await countsOf(tree, {
          sector: h.sector,
          territory: h.territory,
          area: h.area,
          region: h.region,
        }),
      ).toEqual({ sector: 1, territory: 1, area: 1, region: 1 });
      expect((await tree.get(nation.id)).aoCount).toBe(nationBefore);
    });

    it("counts an AO through the five-tier shape with no territory", async () => {
      const tree = newTree();
      const [sector, area, region] = await tree.chain([
        "sector",
        "area",
        "region",
        "ao",
      ]);

      expect(
        await countsOf(tree, {
          sector: must(sector),
          area: must(area),
          region: must(region),
        }),
      ).toEqual({ sector: 1, area: 1, region: 1 });
    });

    it("counts a mixed sector: the total for the sector, each branch for its own tiers", async () => {
      const tree = newTree();
      const sector = await tree.create({ orgType: "sector" });
      const [areaDirect, regionDirect] = await tree.chain(["area", "region"], {
        parentId: sector.id,
      });
      await tree.create({ orgType: "ao", parentId: must(regionDirect).id });
      await tree.create({ orgType: "ao", parentId: must(regionDirect).id });
      const [territory, areaUnder, regionUnder] = await tree.chain(
        ["territory", "area", "region"],
        { parentId: sector.id },
      );
      await tree.create({ orgType: "ao", parentId: must(regionUnder).id });

      expect(
        await countsOf(tree, {
          sector,
          territory: must(territory),
          areaDirect: must(areaDirect),
          areaUnder: must(areaUnder),
          regionDirect: must(regionDirect),
          regionUnder: must(regionUnder),
        }),
      ).toEqual({
        sector: 3,
        territory: 1,
        areaDirect: 2,
        areaUnder: 1,
        regionDirect: 2,
        regionUnder: 1,
      });
    });

    it("does not count an AO created inactive", async () => {
      const tree = newTree();
      const [sector, area, region] = await tree.chain([
        "sector",
        "area",
        "region",
      ]);
      await tree.create({
        orgType: "ao",
        parentId: must(region).id,
        isActive: false,
      });

      expect(
        await countsOf(tree, {
          sector: must(sector),
          area: must(area),
          region: must(region),
        }),
      ).toEqual({ sector: 0, area: 0, region: 0 });
    });
  });

  describe("AO lifecycle", () => {
    it("updates every ancestor when an AO is deactivated, reactivated, and deleted", async () => {
      const tree = newTree();
      const h = await tree.hierarchy();
      const named = {
        sector: h.sector,
        territory: h.territory,
        area: h.area,
        region: h.region,
      };

      await tree.setActive(h.ao.id, false);
      expect(await countsOf(tree, named)).toEqual({
        sector: 0,
        territory: 0,
        area: 0,
        region: 0,
      });

      await tree.setActive(h.ao.id, true);
      expect(await countsOf(tree, named)).toEqual({
        sector: 1,
        territory: 1,
        area: 1,
        region: 1,
      });

      await tree.remove(h.ao.id);
      expect(await countsOf(tree, named)).toEqual({
        sector: 0,
        territory: 0,
        area: 0,
        region: 0,
      });
    });
  });

  describe("inactive intermediates", () => {
    it.each(["region", "area", "territory"] as const)(
      "drops AOs beneath an inactive %s from the tiers above it, not from itself, and restores them",
      async (deactivated) => {
        const tree = newTree();
        const h = await tree.hierarchy();
        const tiers = ["sector", "territory", "area", "region"] as const;
        const named = Object.fromEntries(tiers.map((tier) => [tier, h[tier]]));
        const cutoff = tiers.indexOf(deactivated);
        const expectedWhileInactive = Object.fromEntries(
          tiers.map((tier, index) => [tier, index < cutoff ? 0 : 1]),
        );

        await tree.setActive(h[deactivated].id, false);
        expect(await countsOf(tree, named)).toEqual(expectedWhileInactive);

        await tree.setActive(h[deactivated].id, true);
        expect(await countsOf(tree, named)).toEqual({
          sector: 1,
          territory: 1,
          area: 1,
          region: 1,
        });
      },
    );
  });

  describe("moves", () => {
    it("recounts both chains when an AO moves between regions in different chains", async () => {
      const tree = newTree();
      const [sectorX, areaX, regionX, ao] = await tree.chain([
        "sector",
        "area",
        "region",
        "ao",
      ]);
      const [sectorY, areaY, regionY] = await tree.chain([
        "sector",
        "area",
        "region",
      ]);
      const named = {
        sectorX: must(sectorX),
        areaX: must(areaX),
        regionX: must(regionX),
        sectorY: must(sectorY),
        areaY: must(areaY),
        regionY: must(regionY),
      };

      await tree.move(must(ao).id, must(regionY).id);

      expect(await countsOf(tree, named)).toEqual({
        sectorX: 0,
        areaX: 0,
        regionX: 0,
        sectorY: 1,
        areaY: 1,
        regionY: 1,
      });
    });

    it("recounts the territory when an area moves between a sector and a territory and back", async () => {
      const tree = newTree();
      const sector = await tree.create({ orgType: "sector" });
      const territory = await tree.create({
        orgType: "territory",
        parentId: sector.id,
      });
      const [area] = await tree.chain(["area", "region", "ao"], {
        parentId: sector.id,
      });
      const named = { sector, territory, area: must(area) };

      expect(await countsOf(tree, named)).toEqual({
        sector: 1,
        territory: 0,
        area: 1,
      });

      await tree.move(must(area).id, territory.id);
      expect(await countsOf(tree, named)).toEqual({
        sector: 1,
        territory: 1,
        area: 1,
      });

      await tree.move(must(area).id, sector.id);
      expect(await countsOf(tree, named)).toEqual({
        sector: 1,
        territory: 0,
        area: 1,
      });
    });

    it("recounts both sectors and the territory when an area moves across sectors", async () => {
      const tree = newTree();
      const sector1 = await tree.create({ orgType: "sector" });
      const [sector2, territory2] = await tree.chain(["sector", "territory"]);
      const [area] = await tree.chain(["area", "region", "ao"], {
        parentId: sector1.id,
      });

      await tree.move(must(area).id, must(territory2).id);

      expect(
        await countsOf(tree, {
          sector1,
          sector2: must(sector2),
          territory2: must(territory2),
        }),
      ).toEqual({ sector1: 0, sector2: 1, territory2: 1 });
    });

    it("recounts both chains when a region moves between areas in different sectors", async () => {
      const tree = newTree();
      const [sectorA, areaA] = await tree.chain(["sector", "area"]);
      const [sectorB, areaB] = await tree.chain(["sector", "area"]);
      const [region] = await tree.chain(["region", "ao"], {
        parentId: must(areaA).id,
      });

      await tree.move(must(region).id, must(areaB).id);

      expect(
        await countsOf(tree, {
          sectorA: must(sectorA),
          areaA: must(areaA),
          sectorB: must(sectorB),
          areaB: must(areaB),
        }),
      ).toEqual({ sectorA: 0, areaA: 0, sectorB: 1, areaB: 1 });
    });

    it("recounts both sectors when a territory moves between sectors", async () => {
      const tree = newTree();
      const sector1 = await tree.create({ orgType: "sector" });
      const sector2 = await tree.create({ orgType: "sector" });
      const [territory] = await tree.chain(
        ["territory", "area", "region", "ao"],
        { parentId: sector1.id },
      );

      await tree.move(must(territory).id, sector2.id);

      expect(
        await countsOf(tree, { sector1, sector2, territory: must(territory) }),
      ).toEqual({ sector1: 0, sector2: 1, territory: 1 });
    });
  });

  describe("changes the trigger must notice", () => {
    it("recounts the ancestors when an AO becomes a region and back", async () => {
      const tree = newTree();
      const [sector, area, region, ao] = await tree.chain([
        "sector",
        "area",
        "region",
        "ao",
      ]);
      const named = {
        sector: must(sector),
        area: must(area),
        region: must(region),
      };
      const setType = (orgType: OrgType) =>
        db
          .update(schema.orgs)
          .set({ orgType })
          .where(eq(schema.orgs.id, must(ao).id));

      await setType("region");
      expect(await countsOf(tree, named)).toEqual({
        sector: 0,
        area: 0,
        region: 0,
      });

      await setType("ao");
      expect(await countsOf(tree, named)).toEqual({
        sector: 1,
        area: 1,
        region: 1,
      });
    });

    it("recounts the old chain when an area with an AO beneath it is detached", async () => {
      const tree = newTree();
      const [sector, territory, area, region] = await tree.chain([
        "sector",
        "territory",
        "area",
        "region",
        "ao",
      ]);

      await tree.move(must(area).id, null);

      expect(
        await countsOf(tree, {
          sector: must(sector),
          territory: must(territory),
          area: must(area),
          region: must(region),
        }),
      ).toEqual({ sector: 0, territory: 0, area: 1, region: 1 });
    });

    it("deletes a parentless area", async () => {
      const tree = newTree();
      const area = await tree.create({ orgType: "area" });

      await expect(tree.remove(area.id)).resolves.toBeUndefined();

      expect(
        await db
          .select({ id: schema.orgs.id })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, area.id)),
      ).toEqual([]);
    });
  });

  describe("writes that change nothing", () => {
    it("leaves counts and ancestor timestamps untouched on a rename or an unchanged save", async () => {
      const tree = newTree();
      const h = await tree.hierarchy();
      const snapshot = async (orgs: TreeOrg[]) =>
        (await Promise.all(orgs.map((org) => tree.get(org.id)))).map((org) => [
          org.aoCount,
          org.updated,
        ]);

      const aboveAo = [h.sector, h.territory, h.area, h.region];
      const beforeRename = await snapshot(aboveAo);
      await db
        .update(schema.orgs)
        .set({ name: `${h.ao.name} renamed` })
        .where(eq(schema.orgs.id, h.ao.id));
      expect(await snapshot(aboveAo)).toEqual(beforeRename);

      // Resubmitting the area's own values still bumps that row's timestamp,
      // but nothing above it may change.
      const aboveArea = [h.sector, h.territory];
      const beforeSave = await snapshot(aboveArea);
      await db
        .update(schema.orgs)
        .set({ parentId: h.area.parentId, isActive: true })
        .where(eq(schema.orgs.id, h.area.id));
      expect(await snapshot(aboveArea)).toEqual(beforeSave);
    });
  });

  describe("depth", () => {
    it("counts correctly through repeated and unusual tier types", async () => {
      const tree = newTree();
      const orgs = await tree.chain([
        "sector",
        "territory",
        "area",
        "region",
        "region",
        "region",
        "region",
        "region",
        "ao",
      ]);

      const counts = await Promise.all(
        orgs.slice(0, -1).map((org) => tree.aoCount(org.id)),
      );

      expect(counts).toEqual(Array<number>(orgs.length - 1).fill(1));
    });

    it("counts an AO at the same depth limit the TypeScript traversals use", async () => {
      const tree = newTree();
      // The SQL hardcodes its cap; this and the next test fail if it drifts
      // from ORG_TREE_MAX_DEPTH in either direction.
      const orgs = await tree.chain([
        "sector",
        ...Array<OrgType>(ORG_TREE_MAX_DEPTH - 1).fill("area"),
        "ao",
      ]);

      expect(orgs).toHaveLength(ORG_TREE_MAX_DEPTH + 1);
      expect(await tree.aoCount(must(orgs[0]).id)).toBe(1);
      expect(await tree.aoCount(must(orgs[10]).id)).toBe(1);
    });

    it("does not count an AO one level beyond the depth limit", async () => {
      const tree = newTree();
      const orgs = await tree.chain([
        "sector",
        ...Array<OrgType>(ORG_TREE_MAX_DEPTH).fill("area"),
        "ao",
      ]);

      expect(orgs).toHaveLength(ORG_TREE_MAX_DEPTH + 2);
      expect(await tree.aoCount(must(orgs[0]).id)).toBe(0);
      expect(await tree.aoCount(must(orgs[1]).id)).toBe(1);
      // The trigger stops at the shallower of its two caps; a full recount
      // exercises the counting cap on its own.
      await recount();
      expect(await tree.aoCount(must(orgs[0]).id)).toBe(0);
      expect(await tree.aoCount(must(orgs[1]).id)).toBe(1);
    });

    it("terminates when the hierarchy contains a cycle", async () => {
      const tree = newTree();
      const [area, region] = await tree.chain(["area", "region"]);
      await tree.create({ orgType: "ao", parentId: must(region).id });

      await expect(
        tree.move(must(area).id, must(region).id),
      ).resolves.toBeUndefined();
      await expect(recount()).resolves.toBeTypeOf("number");
      expect(
        await countsOf(tree, { area: must(area), region: must(region) }),
      ).toEqual({ area: 1, region: 1 });
    });

    it("counts an AO once when an organization is its own parent", async () => {
      const tree = newTree();
      const [sector, area, region] = await tree.chain([
        "sector",
        "area",
        "region",
        "ao",
      ]);

      await tree.move(must(sector).id, must(sector).id);

      expect(
        await countsOf(tree, {
          sector: must(sector),
          area: must(area),
          region: must(region),
        }),
      ).toEqual({ sector: 1, area: 1, region: 1 });
    });
  });

  describe("concurrency", () => {
    it("counts both AOs when two transactions insert under one region", async () => {
      const tree = newTree();
      const [sector, area, region] = await tree.chain([
        "sector",
        "area",
        "region",
      ]);
      const parentId = must(region).id;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let firstInserted!: () => void;
      const inserted = new Promise<void>((resolve) => {
        firstInserted = resolve;
      });

      try {
        const first = db.transaction(async (tx) => {
          await tx.insert(schema.orgs).values({
            name: "concurrent-1",
            orgType: "ao",
            parentId,
            isActive: true,
          });
          firstInserted();
          await gate;
        });
        await inserted;
        const second = db.transaction(async (tx) => {
          await tx.insert(schema.orgs).values({
            name: "concurrent-2",
            orgType: "ao",
            parentId,
            isActive: true,
          });
        });
        // Let the second insert reach the row lock the first still holds.
        await new Promise((resolve) => setTimeout(resolve, 300));
        release();
        await Promise.all([first, second]);

        expect(
          await countsOf(tree, {
            sector: must(sector),
            area: must(area),
            region: must(region),
          }),
        ).toEqual({ sector: 2, area: 2, region: 2 });
      } finally {
        release();
        await db.delete(schema.orgs).where(eq(schema.orgs.parentId, parentId));
      }
    });
  });

  describe("concurrent reparenting", () => {
    it("counts an AO inserted while its area is being moved to another sector", async () => {
      const tree = newTree();
      const sector1 = await tree.create({ orgType: "sector" });
      const [sector2, territory] = await tree.chain(["sector", "territory"]);
      const [area, region] = await tree.chain(["area", "region"], {
        parentId: sector1.id,
      });
      const regionId = must(region).id;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let moved!: () => void;
      const areaMoved = new Promise<void>((resolve) => {
        moved = resolve;
      });

      try {
        const mover = db.transaction(async (tx) => {
          await tx
            .update(schema.orgs)
            .set({ parentId: must(territory).id })
            .where(eq(schema.orgs.id, must(area).id));
          moved();
          await gate;
        });
        await areaMoved;
        // Its ancestors are read from the committed tree, where the area is
        // still under sector1, while the move holds the area's row lock.
        const inserter = db.transaction(async (tx) => {
          await tx.insert(schema.orgs).values({
            name: "concurrent-move-ao",
            orgType: "ao",
            parentId: regionId,
            isActive: true,
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        release();
        await Promise.all([mover, inserter]);

        expect(
          await countsOf(tree, {
            sector1,
            sector2: must(sector2),
            territory: must(territory),
            area: must(area),
            region: must(region),
          }),
        ).toEqual({ sector1: 0, sector2: 1, territory: 1, area: 1, region: 1 });
      } finally {
        release();
        await db.delete(schema.orgs).where(eq(schema.orgs.parentId, regionId));
      }
    });
  });

  describe("recount function", () => {
    it("reports expected counts without writing, repairs corrupted counts, and is idempotent", async () => {
      const tree = newTree();
      const h = await tree.hierarchy();
      const ids = [h.sector.id, h.territory.id, h.area.id, h.region.id];
      await db
        .update(schema.orgs)
        .set({ aoCount: 99 })
        .where(inArray(schema.orgs.id, ids));

      const expected = await db.execute<{ org_id: number; expected: number }>(
        sql`SELECT org_id, expected FROM public.org_ao_count_expected(${idArray(ids)})`,
      );
      expect(
        expected
          .map((row) => [Number(row.org_id), Number(row.expected)])
          .sort(),
      ).toEqual(ids.map((id) => [id, 1]).sort());
      expect(await tree.aoCount(h.sector.id)).toBe(99);

      expect(await recount()).toBeGreaterThanOrEqual(ids.length);
      expect(
        await countsOf(tree, {
          sector: h.sector,
          territory: h.territory,
          area: h.area,
          region: h.region,
        }),
      ).toEqual({ sector: 1, territory: 1, area: 1, region: 1 });
      expect(await recount()).toBe(0);
    });

    it("recounts only the chains above the given organizations", async () => {
      const tree = newTree();
      const h = await tree.hierarchy();
      const other = await tree.chain(["sector", "area", "region", "ao"]);
      await db
        .update(schema.orgs)
        .set({ aoCount: 99 })
        .where(inArray(schema.orgs.id, [h.sector.id, must(other[0]).id]));

      const changed = await recount([h.ao.id]);

      expect(changed).toBe(1);
      expect(await tree.aoCount(h.sector.id)).toBe(1);
      expect(await tree.aoCount(must(other[0]).id)).toBe(99);
    });
  });

  describe("disabling the trigger", () => {
    it.each([
      { setting: "true", counted: false },
      { setting: "false", counted: true },
      { setting: "", counted: true },
    ])(
      "with app.disable_ao_count_trigger set to '$setting' the AO is counted: $counted",
      async ({ setting, counted }) => {
        const tree = newTree();
        const [, , region] = await tree.chain(["sector", "area", "region"]);
        const parentId = must(region).id;

        try {
          const regionCount = await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT set_config('app.disable_ao_count_trigger', ${setting}, true)`,
            );
            await tx.insert(schema.orgs).values({
              name: "guc-ao",
              orgType: "ao",
              parentId,
              isActive: true,
            });
            const [row] = await tx
              .select({ aoCount: schema.orgs.aoCount })
              .from(schema.orgs)
              .where(eq(schema.orgs.id, parentId));
            return row?.aoCount;
          });

          expect(regionCount).toBe(counted ? 1 : 0);
        } finally {
          await db
            .delete(schema.orgs)
            .where(eq(schema.orgs.parentId, parentId));
        }
      },
    );
  });

  describe("randomized mutations", () => {
    interface Node {
      id: number;
      orgType: OrgType;
      parentId: number | null;
      isActive: boolean;
    }

    const mulberry32 = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Independent of the SQL: count active AOs reached through active non-AO nodes.
    const expectedCount = (nodes: Node[], rootId: number): number => {
      let total = 0;
      for (const child of nodes.filter((node) => node.parentId === rootId)) {
        if (child.orgType === "ao") total += child.isActive ? 1 : 0;
        else if (child.isActive) total += expectedCount(nodes, child.id);
      }
      return total;
    };

    it("keeps stored counts equal to an independent recomputation after every mutation", async () => {
      const seed = 924;
      const random = mulberry32(seed);
      const pick = <T>(items: T[]): T | undefined =>
        items[Math.floor(random() * items.length)];
      const tree = newTree();
      const nodes: Node[] = [];

      const add = async (orgType: OrgType, parentId: number | null) => {
        const isActive = random() > 0.15;
        const org = await tree.create({ orgType, parentId, isActive });
        nodes.push({ id: org.id, orgType, parentId, isActive });
        return org;
      };

      const sectors = [await add("sector", null), await add("sector", null)];
      const territories = await Promise.all(
        sectors.map((sector) => add("territory", sector.id)),
      );
      const areas = [
        await add("area", must(sectors[0]).id),
        await add("area", must(territories[0]).id),
        await add("area", must(territories[1]).id),
      ];
      const regions = await Promise.all(
        areas.map((area) => add("region", area.id)),
      );
      for (const region of regions) {
        await add("ao", region.id);
        await add("ao", region.id);
      }

      const isCountCarrying = (node: Node) =>
        node.orgType !== "ao" && node.orgType !== "nation";

      const assertCounts = async (step: string) => {
        const carrying = nodes.filter(isCountCarrying);
        const stored = await db
          .select({ id: schema.orgs.id, aoCount: schema.orgs.aoCount })
          .from(schema.orgs)
          .where(
            inArray(
              schema.orgs.id,
              carrying.map((node) => node.id),
            ),
          );
        const byId = new Map(stored.map((row) => [row.id, row.aoCount]));
        const mismatches = carrying
          .filter((node) => byId.get(node.id) !== expectedCount(nodes, node.id))
          .map((node) => ({
            id: node.id,
            orgType: node.orgType,
            stored: byId.get(node.id),
            expected: expectedCount(nodes, node.id),
          }));
        expect(mismatches, `seed ${seed}, after ${step}`).toEqual([]);
      };

      await assertCounts("setup");

      for (let step = 1; step <= 120; step++) {
        const roll = random();
        let description: string;

        if (roll < 0.35) {
          const node = must(pick(nodes));
          node.isActive = !node.isActive;
          await tree.setActive(node.id, node.isActive);
          description = `toggle ${node.orgType} ${node.id}`;
        } else if (roll < 0.7) {
          const node = pick(nodes.filter((n) => n.orgType !== "sector"));
          if (!node) continue;
          const parents = nodes.filter(
            (candidate) =>
              candidate.id !== node.parentId &&
              (node.orgType === "ao"
                ? candidate.orgType === "region"
                : orgTypeRank(candidate.orgType) > orgTypeRank(node.orgType) &&
                  candidate.orgType !== "nation"),
          );
          const parent = pick(parents);
          if (!parent) continue;
          node.parentId = parent.id;
          await tree.move(node.id, parent.id);
          description = `move ${node.orgType} ${node.id} under ${parent.orgType} ${parent.id}`;
        } else if (roll < 0.85) {
          const parent = must(
            pick(nodes.filter((n) => n.orgType === "region")),
          );
          const ao = await add("ao", parent.id);
          description = `insert ao ${ao.id} under region ${parent.id}`;
        } else {
          const ao = pick(nodes.filter((n) => n.orgType === "ao"));
          if (!ao) continue;
          nodes.splice(nodes.indexOf(ao), 1);
          await tree.remove(ao.id);
          description = `delete ao ${ao.id}`;
        }

        await assertCounts(`step ${step}: ${description}`);
      }
    });
  });
});
