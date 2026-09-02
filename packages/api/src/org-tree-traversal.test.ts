import type { Session } from "@acme/auth";
import type { OrgType, UserRole } from "@acme/shared/app/enums";
import { eq, inArray, schema } from "@acme/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as loggerModule from "./logger";

vi.mock("./logger", { spy: true });

const mockLogWarn = vi.mocked(loggerModule.logWarn);

import { db, getOrCreateRoles, uniqueId } from "./__tests__/test-utils";
import { checkHasRoleOnOrg } from "./check-has-role-on-org";
import { getDescendantOrgIds } from "./get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "./get-editable-org-ids";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";
import type { Context } from "./shared";

describe("organization tree traversal", () => {
  interface TestOrg {
    id: number;
    name: string;
    orgType: OrgType;
  }

  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];
  let adminRoleId: number;
  let editorRoleId: number;

  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  beforeAll(async () => {
    await getOrCreateRoles();

    const roles = await db
      .select({ id: schema.roles.id, name: schema.roles.name })
      .from(schema.roles);
    const adminRole = roles.find((role) => role.name === "admin");
    const editorRole = roles.find((role) => role.name === "editor");
    if (!adminRole || !editorRole) {
      throw new Error("Required test roles are missing");
    }
    adminRoleId = adminRole.id;
    editorRoleId = editorRole.id;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(inArray(schema.rolesXUsersXOrg.userId, createdUserIds));
    }

    if (createdOrgIds.length > 0) {
      await db
        .update(schema.orgs)
        .set({ parentId: null })
        .where(inArray(schema.orgs.id, createdOrgIds));
    }

    if (createdUserIds.length > 0) {
      await db
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds));
    }

    if (createdOrgIds.length > 0) {
      await db
        .delete(schema.orgs)
        .where(inArray(schema.orgs.id, createdOrgIds));
    }
  });

  const createOrgChain = async (types: OrgType[]) => {
    const orgs: TestOrg[] = [];
    let parentId: number | null = null;

    for (const [index, orgType] of types.entries()) {
      const insertedOrgs: TestOrg[] = await db
        .insert(schema.orgs)
        .values({
          name: `Traversal ${uniqueId()} ${index}`,
          orgType,
          parentId,
          isActive: true,
        })
        .returning({
          id: schema.orgs.id,
          name: schema.orgs.name,
          orgType: schema.orgs.orgType,
        });
      const org = insertedOrgs[0];
      if (!org) throw new Error("Failed to create traversal org");

      createdOrgIds.push(org.id);
      orgs.push(org);
      parentId = org.id;
    }

    return orgs;
  };

  const createSession = (params: {
    userId: number;
    orgId: number;
    orgName: string;
    roleName: UserRole;
  }): Session => ({
    id: params.userId,
    email: `traversal-${params.userId}@example.com`,
    user: {
      id: String(params.userId),
      email: `traversal-${params.userId}@example.com`,
      name: "Traversal Test User",
      roles: [
        {
          orgId: params.orgId,
          orgName: params.orgName,
          roleName: params.roleName,
        },
      ],
    },
    roles: [
      {
        orgId: params.orgId,
        orgName: params.orgName,
        roleName: params.roleName,
      },
    ],
    expires: new Date(Date.now() + 60_000).toISOString(),
  });

  const createDbRoleContext = async (
    org: { id: number; name: string },
    roleName: "admin" | "editor",
  ): Promise<Context> => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `traversal-${uniqueId()}@example.com`,
        f3Name: "Traversal Test User",
      })
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!user) throw new Error("Failed to create traversal user");
    createdUserIds.push(user.id);

    await db.insert(schema.rolesXUsersXOrg).values({
      userId: user.id,
      orgId: org.id,
      roleId: roleName === "admin" ? adminRoleId : editorRoleId,
    });

    return {
      db,
      session: createSession({
        userId: user.id,
        orgId: org.id,
        orgName: org.name,
        roleName,
      }),
    };
  };

  it("preserves role checks on the current five-level hierarchy", async () => {
    const [nation, , , region, ao] = await createOrgChain([
      "nation",
      "sector",
      "area",
      "region",
      "ao",
    ]);
    const [unrelated] = await createOrgChain(["region"]);
    if (!nation || !region || !ao || !unrelated) {
      throw new Error("Failed to create five-level fixture");
    }

    const inheritedSession = createSession({
      userId: 101,
      orgId: nation.id,
      orgName: nation.name,
      roleName: "admin",
    });
    const directSession = createSession({
      userId: 102,
      orgId: region.id,
      orgName: region.name,
      roleName: "editor",
    });
    const unrelatedSession = createSession({
      userId: 103,
      orgId: unrelated.id,
      orgName: unrelated.name,
      roleName: "admin",
    });
    const inheritedEditorSession = createSession({
      userId: 104,
      orgId: nation.id,
      orgName: nation.name,
      roleName: "editor",
    });
    const descendantEditorSession = createSession({
      userId: 105,
      orgId: ao.id,
      orgName: ao.name,
      roleName: "editor",
    });

    await expect(
      checkHasRoleOnOrg({
        session: inheritedSession,
        orgId: ao.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: true,
      orgId: nation.id,
      roleName: "admin",
      mode: "org-admin",
    });
    await expect(
      checkHasRoleOnOrg({
        session: directSession,
        orgId: region.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: true,
      orgId: region.id,
      roleName: "editor",
      mode: "direct-permission",
    });
    await expect(
      checkHasRoleOnOrg({
        session: unrelatedSession,
        orgId: ao.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: false,
      orgId: ao.id,
      roleName: "editor",
      mode: "no-permission",
    });
    await expect(
      checkHasRoleOnOrg({
        session: inheritedEditorSession,
        orgId: ao.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: true,
      orgId: nation.id,
      roleName: "editor",
      mode: "org-admin",
    });
    await expect(
      checkHasRoleOnOrg({
        session: inheritedEditorSession,
        orgId: ao.id,
        db,
        roleName: "admin",
      }),
    ).resolves.toEqual({
      success: false,
      orgId: ao.id,
      roleName: "admin",
      mode: "no-permission",
    });
    await expect(
      checkHasRoleOnOrg({
        session: descendantEditorSession,
        orgId: nation.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: false,
      orgId: nation.id,
      roleName: "editor",
      mode: "no-permission",
    });
    await expect(
      checkHasRoleOnOrg({
        session: null,
        orgId: ao.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });
    await expect(
      checkHasRoleOnOrg({
        session: inheritedSession,
        orgId: 2_147_483_647,
        db,
        roleName: "editor",
      }),
    ).resolves.toEqual({
      success: false,
      orgId: 2_147_483_647,
      roleName: "editor",
      mode: "no-permission",
    });
  });

  it("preserves editable org and descendant results on five levels", async () => {
    const [nation, sector, area, region, ao] = await createOrgChain([
      "nation",
      "sector",
      "area",
      "region",
      "ao",
    ]);
    if (!nation || !sector || !area || !region || !ao) {
      throw new Error("Failed to create five-level fixture");
    }

    const ctx = await createDbRoleContext(sector, "editor");
    const editableResult = await getEditableOrgIdsForUser(ctx);
    expect(editableResult.isNationAdmin).toBe(false);
    expect(new Set(editableResult.editableOrgs.map((org) => org.id))).toEqual(
      new Set([sector.id, area.id, region.id]),
    );
    expect(editableResult.editableOrgs).toHaveLength(3);
    expect(editableResult.editableRootOrgIds).toEqual([sector.id]);

    const descendants = await getDescendantOrgIds(db, [nation.id]);
    expect(new Set(descendants)).toEqual(
      new Set([nation.id, sector.id, area.id, region.id, ao.id]),
    );
    expect(descendants).toHaveLength(5);
    const overlappingDescendants = await getDescendantOrgIds(db, [
      nation.id,
      area.id,
    ]);
    expect(new Set(overlappingDescendants)).toEqual(new Set(descendants));
    expect(overlappingDescendants).toHaveLength(5);
    await expect(getDescendantOrgIds(db, [])).resolves.toEqual([]);
    await expect(getDescendantOrgIds(db, [2_147_483_647])).resolves.toEqual([]);
  });

  it("returns no editable organizations without a session", async () => {
    await expect(
      getEditableOrgIdsForUser({ db, session: null }),
    ).resolves.toEqual({
      editableOrgs: [],
      editableRootOrgIds: [],
      isNationAdmin: false,
    });
  });

  it("preserves nation editor handling", async () => {
    const [nation] = await createOrgChain(["nation"]);
    if (!nation) throw new Error("Failed to create nation fixture");

    const ctx = await createDbRoleContext(nation, "editor");
    await expect(getEditableOrgIdsForUser(ctx)).resolves.toEqual({
      editableOrgs: [],
      editableRootOrgIds: [],
      isNationAdmin: true,
    });
  });

  it("reaches the deepest node in a synthetic six-level hierarchy", async () => {
    const chain = await createOrgChain([
      "sector",
      "area",
      "region",
      "region",
      "region",
      "region",
    ]);
    const root = chain[0];
    const deepest = chain[5];
    if (!root || !deepest) {
      throw new Error("Failed to create six-level fixture");
    }

    const session = createSession({
      userId: 201,
      orgId: root.id,
      orgName: root.name,
      roleName: "admin",
    });
    await expect(
      checkHasRoleOnOrg({
        session,
        orgId: deepest.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toMatchObject({ success: true, orgId: root.id });

    const ctx = await createDbRoleContext(root, "admin");
    const editableResult = await getEditableOrgIdsForUser(ctx);
    expect(editableResult.editableRootOrgIds).toEqual([root.id]);
    expect(editableResult.editableOrgs.map((org) => org.id)).toContain(
      deepest.id,
    );

    const descendants = await getDescendantOrgIds(db, [root.id]);
    expect(descendants).toContain(deepest.id);
  });

  it("enforces the same maximum traversal depth in all three functions", async () => {
    const chain = await createOrgChain(
      Array.from({ length: ORG_TREE_MAX_DEPTH + 2 }, () => "region" as const),
    );
    const root = chain[0];
    const withinGuard = chain[ORG_TREE_MAX_DEPTH];
    const beyondGuard = chain[ORG_TREE_MAX_DEPTH + 1];
    if (!root || !withinGuard || !beyondGuard) {
      throw new Error("Failed to create depth-guard fixture");
    }

    const session = createSession({
      userId: 301,
      orgId: root.id,
      orgName: root.name,
      roleName: "admin",
    });
    await expect(
      checkHasRoleOnOrg({
        session,
        orgId: withinGuard.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      checkHasRoleOnOrg({
        session,
        orgId: beyondGuard.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toMatchObject({ success: false });
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenLastCalledWith(
      "api.org_tree.depth_limit_reached",
      {
        direction: "ancestors",
        maxDepth: ORG_TREE_MAX_DEPTH,
        rootCount: 1,
        source: "role_check",
      },
    );

    mockLogWarn.mockClear();
    const ctx = await createDbRoleContext(root, "admin");
    const editableResult = await getEditableOrgIdsForUser(ctx);
    expect(editableResult.editableRootOrgIds).toEqual([root.id]);
    expect(editableResult.editableOrgs).toHaveLength(ORG_TREE_MAX_DEPTH + 1);
    expect(editableResult.editableOrgs.map((org) => org.id)).not.toContain(
      beyondGuard.id,
    );
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenLastCalledWith(
      "api.org_tree.depth_limit_reached",
      {
        direction: "descendants",
        maxDepth: ORG_TREE_MAX_DEPTH,
        rootCount: 1,
        source: "editable_orgs",
      },
    );

    // Production callers use the direct roots so the depth budget is applied
    // once instead of composing two independently bounded traversals.
    mockLogWarn.mockClear();
    const descendants = await getDescendantOrgIds(
      db,
      editableResult.editableRootOrgIds,
    );
    expect(descendants).toHaveLength(ORG_TREE_MAX_DEPTH + 1);
    expect(descendants).not.toContain(beyondGuard.id);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenLastCalledWith(
      "api.org_tree.depth_limit_reached",
      {
        direction: "descendants",
        maxDepth: ORG_TREE_MAX_DEPTH,
        rootCount: 1,
        source: "descendant_orgs",
      },
    );

    // Every node is within the return boundary from at least one direct root,
    // even though the deepest node also has a path beyond the boundary.
    mockLogWarn.mockClear();
    const overlappingDescendants = await getDescendantOrgIds(db, [
      root.id,
      chain[1]!.id,
    ]);
    expect(overlappingDescendants).toContain(beyondGuard.id);
    expect(mockLogWarn).not.toHaveBeenCalled();

    if (!ctx.session) throw new Error("Missing depth-guard session");
    await db.insert(schema.rolesXUsersXOrg).values({
      userId: ctx.session.id,
      orgId: chain[1]!.id,
      roleId: editorRoleId,
    });
    const overlappingEditableResult = await getEditableOrgIdsForUser(ctx);
    expect(
      overlappingEditableResult.editableOrgs.map((org) => org.id),
    ).toContain(beyondGuard.id);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it("does not warn when a hierarchy ends exactly at the depth boundary", async () => {
    const chain = await createOrgChain(
      Array.from({ length: ORG_TREE_MAX_DEPTH + 1 }, () => "region" as const),
    );
    const root = chain[0];
    const boundary = chain[ORG_TREE_MAX_DEPTH];
    if (!root || !boundary) {
      throw new Error("Failed to create exact-boundary fixture");
    }

    const session = createSession({
      userId: 302,
      orgId: root.id,
      orgName: root.name,
      roleName: "admin",
    });
    await checkHasRoleOnOrg({
      session,
      orgId: boundary.id,
      db,
      roleName: "editor",
    });
    expect(mockLogWarn).not.toHaveBeenCalled();

    const ctx = await createDbRoleContext(root, "admin");
    const editableResult = await getEditableOrgIdsForUser(ctx);
    expect(editableResult.editableOrgs).toHaveLength(ORG_TREE_MAX_DEPTH + 1);
    expect(mockLogWarn).not.toHaveBeenCalled();

    const descendants = await getDescendantOrgIds(db, [root.id]);
    expect(descendants).toHaveLength(ORG_TREE_MAX_DEPTH + 1);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it("preserves AO roots, stops below excluded AOs, and deduplicates overlapping role roots", async () => {
    const [region, ao, nestedRegion] = await createOrgChain([
      "region",
      "ao",
      "region",
    ]);
    if (!region || !ao || !nestedRegion) {
      throw new Error("Failed to create AO traversal fixture");
    }

    const regionCtx = await createDbRoleContext(region, "admin");
    const regionResult = await getEditableOrgIdsForUser(regionCtx);
    expect(regionResult.editableRootOrgIds).toEqual([region.id]);
    expect(regionResult.editableOrgs).toEqual([
      { id: region.id, type: "region" },
    ]);

    const aoCtx = await createDbRoleContext(ao, "admin");
    const aoResult = await getEditableOrgIdsForUser(aoCtx);
    expect(aoResult.editableRootOrgIds).toEqual([ao.id]);
    expect(new Set(aoResult.editableOrgs.map((org) => org.id))).toEqual(
      new Set([ao.id, nestedRegion.id]),
    );

    const [root, child, grandchild] = await createOrgChain([
      "region",
      "region",
      "region",
    ]);
    if (!root || !child || !grandchild) {
      throw new Error("Failed to create overlapping-root fixture");
    }

    const overlapCtx = await createDbRoleContext(root, "admin");
    if (!overlapCtx.session) throw new Error("Missing overlap session");
    await db.insert(schema.rolesXUsersXOrg).values({
      userId: overlapCtx.session.id,
      orgId: child.id,
      roleId: editorRoleId,
    });
    const overlapResult = await getEditableOrgIdsForUser(overlapCtx);
    expect(new Set(overlapResult.editableRootOrgIds)).toEqual(
      new Set([root.id, child.id]),
    );
    expect(new Set(overlapResult.editableOrgs.map((org) => org.id))).toEqual(
      new Set([root.id, child.id, grandchild.id]),
    );
    expect(overlapResult.editableOrgs).toHaveLength(3);
  });

  it("terminates and deduplicates results when the hierarchy contains a cycle", async () => {
    const [first, second] = await createOrgChain(["region", "region"]);
    const [unrelated] = await createOrgChain(["region"]);
    if (!first || !second || !unrelated) {
      throw new Error("Failed to create cycle fixture");
    }

    await db
      .update(schema.orgs)
      .set({ parentId: second.id })
      .where(eq(schema.orgs.id, first.id));

    const session = createSession({
      userId: 401,
      orgId: unrelated.id,
      orgName: unrelated.name,
      roleName: "admin",
    });
    await expect(
      checkHasRoleOnOrg({
        session,
        orgId: second.id,
        db,
        roleName: "editor",
      }),
    ).resolves.toMatchObject({ success: false });

    const ctx = await createDbRoleContext(first, "admin");
    const editableResult = await getEditableOrgIdsForUser(ctx);
    const editableIds = editableResult.editableOrgs.map((org) => org.id);
    expect(editableIds).toContain(first.id);
    expect(new Set(editableIds).size).toBe(editableIds.length);
    expect(editableIds.length).toBeLessThanOrEqual(2);

    const descendants = await getDescendantOrgIds(db, [first.id]);
    expect(new Set(descendants)).toEqual(new Set([first.id, second.id]));
    expect(descendants).toHaveLength(2);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
