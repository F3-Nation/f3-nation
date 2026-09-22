import { eq, inArray, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { OrgType } from "@acme/shared/app/enums";
import { afterEach, describe, expect, it } from "vitest";

import { getOrCreateRoles } from "./index";
import type { HierarchyOrgs, OrgTree } from "./org-tree";
import { createOrgTree } from "./org-tree";

describe("createOrgTree", () => {
  const trees: OrgTree[] = [];
  const newTree = () => {
    const tree = createOrgTree();
    trees.push(tree);
    return tree;
  };

  afterEach(async () => {
    await Promise.all(trees.splice(0).map((tree) => tree.cleanup()));
  });

  const findOrgs = (ids: number[]) =>
    db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(inArray(schema.orgs.id, ids));

  it("creates an active org with a unique name and no parent by default", async () => {
    const tree = newTree();
    const [first, second] = await Promise.all([
      tree.create({ orgType: "sector" }),
      tree.create({ orgType: "sector" }),
    ]);

    expect(first).toMatchObject({ orgType: "sector", parentId: null });
    expect(first.name).not.toBe(second.name);
    expect(await tree.get(first.id)).toMatchObject({ isActive: true });
  });

  it("honors an explicit name, parent, and inactive status", async () => {
    const tree = newTree();
    const parent = await tree.create({ orgType: "sector" });
    const child = await tree.create({
      orgType: "territory",
      parentId: parent.id,
      isActive: false,
      name: "Named Territory",
    });

    expect(child.name).toBe("Named Territory");
    expect(await tree.get(child.id)).toMatchObject({
      parentId: parent.id,
      isActive: false,
    });
  });

  it("builds a chain top-down, each org parented to the previous one", async () => {
    const tree = newTree();
    const root = await tree.create({ orgType: "sector" });

    const chain = await tree.chain(["territory", "area", "region"], {
      parentId: root.id,
    });

    expect(chain.map((org) => org.orgType)).toEqual([
      "territory",
      "area",
      "region",
    ]);
    expect(chain.map((org) => org.parentId)).toEqual([
      root.id,
      chain[0]?.id,
      chain[1]?.id,
    ]);
  });

  it("builds a chain with no parent and inactive orgs on request", async () => {
    const tree = newTree();
    const [top, bottom] = await tree.chain(["sector", "area"], {
      isActive: false,
    });

    expect(top?.parentId).toBeNull();
    expect(await tree.get(top?.id ?? -1)).toMatchObject({ isActive: false });
    expect(await tree.get(bottom?.id ?? -1)).toMatchObject({ isActive: false });
  });

  it("builds every tier beneath the root type, derived from OrgType", async () => {
    const tree = newTree();
    const hierarchy = await tree.hierarchy();

    const tiers = OrgType.slice(0, -1).reverse() as (keyof HierarchyOrgs)[];
    expect(Object.keys(hierarchy)).toHaveLength(tiers.length);
    tiers.forEach((tier, index) => {
      const above = tiers[index - 1];
      expect(hierarchy[tier].parentId).toBe(above ? hierarchy[above].id : null);
    });
  });

  it("moves an org to a new parent and clears a parent", async () => {
    const tree = newTree();
    const [sectorA, sectorB] = await Promise.all([
      tree.create({ orgType: "sector" }),
      tree.create({ orgType: "sector" }),
    ]);
    const area = await tree.create({ orgType: "area", parentId: sectorA.id });

    await tree.move(area.id, sectorB.id);
    expect((await tree.get(area.id)).parentId).toBe(sectorB.id);

    await tree.move(area.id, null);
    expect((await tree.get(area.id)).parentId).toBeNull();
  });

  it("toggles active status", async () => {
    const tree = newTree();
    const sector = await tree.create({ orgType: "sector" });

    await tree.setActive(sector.id, false);
    expect((await tree.get(sector.id)).isActive).toBe(false);

    await tree.setActive(sector.id, true);
    expect((await tree.get(sector.id)).isActive).toBe(true);
  });

  it("reads the stored AO count, updated timestamp, and columns of an org", async () => {
    const tree = newTree();
    const sector = await tree.create({ orgType: "sector" });

    expect(await tree.aoCount(sector.id)).toBe(0);
    const row = await tree.get(sector.id);
    expect(row).toMatchObject({ id: sector.id, orgType: "sector", aoCount: 0 });
    expect(row.updated).not.toBeNull();
  });

  it("throws a clear error when reading an org that does not exist", async () => {
    const tree = newTree();
    const sector = await tree.create({ orgType: "sector" });
    await tree.remove(sector.id);

    await expect(tree.get(sector.id)).rejects.toThrow(
      `Org ${sector.id} not found`,
    );
  });

  it("hard deletes an org", async () => {
    const tree = newTree();
    const sector = await tree.create({ orgType: "sector" });

    await tree.remove(sector.id);

    expect(await findOrgs([sector.id])).toEqual([]);
  });

  it("cleans up every created org, including after moves invert the creation order", async () => {
    const tree = newTree();
    const early = await tree.create({ orgType: "area" });
    const late = await tree.create({ orgType: "sector" });
    // The earlier-created org becomes the parent of the later-created one, so
    // deleting in reverse creation order would violate the parent foreign key.
    await tree.move(late.id, early.id);
    const removed = await tree.create({ orgType: "sector" });
    await tree.remove(removed.id);

    await tree.cleanup();

    expect(await findOrgs([early.id, late.id, removed.id])).toEqual([]);
  });

  it("cleans up role assignments attached to created orgs", async () => {
    await getOrCreateRoles();
    const tree = newTree();
    const sector = await tree.create({ orgType: "sector" });
    const [role] = await db.select().from(schema.roles).limit(1);
    const [user] = await db
      .insert(schema.users)
      .values({ email: `${sector.name}@example.com`, f3Name: "Tree Cleanup" })
      .returning({ id: schema.users.id });
    if (!role || !user) throw new Error("Test fixture setup failed");
    await db
      .insert(schema.rolesXUsersXOrg)
      .values({ userId: user.id, roleId: role.id, orgId: sector.id });

    try {
      await tree.cleanup();

      expect(await findOrgs([sector.id])).toEqual([]);
    } finally {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, user.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    }
  });
});
