/**
 * Org hierarchy fixtures for tests that need real parent/child rows.
 *
 * Inserts go straight to the database, bypassing the API, so a test can build
 * shapes the API refuses (for example to exercise a database trigger directly).
 * Like the rest of this directory it has no `vitest` import.
 */

import { randomUUID } from "node:crypto";

import { eq, inArray, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { OrgType } from "@acme/shared/app/enums";

export interface TreeOrg {
  id: number;
  name: string;
  orgType: OrgType;
  parentId: number | null;
}

export interface OrgRow extends TreeOrg {
  isActive: boolean;
  aoCount: number | null;
  updated: string | null;
}

export interface OrgSpec {
  orgType: OrgType;
  parentId?: number | null;
  isActive?: boolean;
  name?: string;
}

export type ChainOptions = Pick<OrgSpec, "parentId" | "isActive">;

/** Every tier beneath the root type (nation), keyed by its org type. */
export type HierarchyOrgs = Record<Exclude<OrgType, "nation">, TreeOrg>;

export interface OrgTree {
  create(spec: OrgSpec): Promise<TreeOrg>;
  /** Creates `types` top-down; each org's parent is the previous one. */
  chain(types: readonly OrgType[], options?: ChainOptions): Promise<TreeOrg[]>;
  /**
   * One org per tier beneath nation, derived from `OrgType` so a new tier is
   * included without editing this file.
   */
  hierarchy(options?: ChainOptions): Promise<HierarchyOrgs>;
  move(id: number, parentId: number | null): Promise<void>;
  setActive(id: number, isActive: boolean): Promise<void>;
  /** Hard-deletes an org that has no children. */
  remove(id: number): Promise<void>;
  get(id: number): Promise<OrgRow>;
  aoCount(id: number): Promise<number>;
  /** Deletes every org this tree created, in an order the parent FK allows. */
  cleanup(): Promise<void>;
}

const deleteOrgs = async (ids: number[]) => {
  await db
    .delete(schema.rolesXUsersXOrg)
    .where(inArray(schema.rolesXUsersXOrg.orgId, ids));
  await db
    .delete(schema.rolesXApiKeysXOrg)
    .where(inArray(schema.rolesXApiKeysXOrg.orgId, ids));
  await db.delete(schema.orgs).where(inArray(schema.orgs.id, ids));
};

export const createOrgTree = (): OrgTree => {
  const label = `tree-${randomUUID().slice(0, 8)}`;
  const created = new Set<number>();
  let sequence = 0;

  const create: OrgTree["create"] = async ({
    orgType,
    parentId = null,
    isActive = true,
    name = `${label} ${orgType} ${(sequence += 1)}`,
  }) => {
    const [org] = await db
      .insert(schema.orgs)
      .values({ name, orgType, parentId, isActive })
      .returning({
        id: schema.orgs.id,
        name: schema.orgs.name,
        orgType: schema.orgs.orgType,
        parentId: schema.orgs.parentId,
      });
    if (!org) throw new Error(`Failed to create ${orgType} org`);

    created.add(org.id);
    return org;
  };

  const chain: OrgTree["chain"] = async (types, options = {}) => {
    const orgs: TreeOrg[] = [];
    let parentId = options.parentId ?? null;

    for (const orgType of types) {
      const org = await create({
        orgType,
        parentId,
        isActive: options.isActive,
      });
      orgs.push(org);
      parentId = org.id;
    }

    return orgs;
  };

  const get: OrgTree["get"] = async (id) => {
    const [org] = await db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        orgType: schema.orgs.orgType,
        parentId: schema.orgs.parentId,
        isActive: schema.orgs.isActive,
        aoCount: schema.orgs.aoCount,
        updated: schema.orgs.updated,
      })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, id));
    if (!org) throw new Error(`Org ${id} not found`);

    return org;
  };

  return {
    create,
    chain,

    async hierarchy(options) {
      const types = OrgType.slice(0, -1).reverse();
      const orgs = await chain(types, options);

      return Object.fromEntries(
        orgs.map((org) => [org.orgType, org]),
      ) as HierarchyOrgs;
    },

    async move(id, parentId) {
      await db
        .update(schema.orgs)
        .set({ parentId })
        .where(eq(schema.orgs.id, id));
    },

    async setActive(id, isActive) {
      await db
        .update(schema.orgs)
        .set({ isActive })
        .where(eq(schema.orgs.id, id));
    },

    async remove(id) {
      await deleteOrgs([id]);
      created.delete(id);
    },

    get,

    async aoCount(id) {
      const { aoCount } = await get(id);
      if (aoCount === null) throw new Error(`Org ${id} has a null ao_count`);

      return aoCount;
    },

    async cleanup() {
      const ids = [...created];
      created.clear();
      if (ids.length === 0) return;

      // Clear parents first: moves can leave a child created before its parent.
      await db
        .update(schema.orgs)
        .set({ parentId: null })
        .where(inArray(schema.orgs.id, ids));
      await deleteOrgs(ids);
    },
  };
};
