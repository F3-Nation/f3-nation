import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { inArray, schema } from "@acme/db";
import { ROLE_PERMISSIONS } from "@acme/shared/app/permissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createMixedOrgTree,
  db,
  getOrCreateRoles,
} from "./__tests__/test-utils";
import { checkHasPermissionOnOrg } from "./check-has-role-on-org";

const makeSession = (
  roles: { orgId: number; orgName: string; roleName: UserRole }[],
  apiKey = false,
): Session =>
  ({
    id: 4242,
    email: "permission-check@example.com",
    user: {
      id: "4242",
      email: "permission-check@example.com",
      name: "Permission Check User",
      roles,
    },
    roles,
    expires: new Date(Date.now() + 60_000).toISOString(),
    ...(apiKey ? { apiKey: { id: 1 } } : {}),
  }) as unknown as Session;

describe("ROLE_PERMISSIONS", () => {
  it("gives admin every permission and editor all but security.manage", () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([
      "entities.manage",
      "messages.send",
      "pii.read",
      "security.manage",
    ]);
    expect([...ROLE_PERMISSIONS.editor].sort()).toEqual([
      "entities.manage",
      "messages.send",
      "pii.read",
    ]);
    expect(ROLE_PERMISSIONS.user).toEqual([]);
    expect(ROLE_PERMISSIONS.password_manager).toEqual([]);
    expect(ROLE_PERMISSIONS.password_reader).toEqual([]);
  });
});

describe("checkHasPermissionOnOrg", () => {
  const createdOrgIds: number[] = [];
  let orgs: Awaited<ReturnType<typeof createMixedOrgTree>>;

  beforeAll(async () => {
    await getOrCreateRoles();
    orgs = await createMixedOrgTree(createdOrgIds);
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await db
        .update(schema.orgs)
        .set({ parentId: null })
        .where(inArray(schema.orgs.id, createdOrgIds));
      await db
        .delete(schema.orgs)
        .where(inArray(schema.orgs.id, createdOrgIds));
    }
  });

  const grant = (orgId: number, roleName: UserRole) => ({
    orgId,
    orgName: `org ${orgId}`,
    roleName,
  });

  it("grants on a direct role whose map includes the permission", async () => {
    const region = orgs.directBranch.region.id;
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([grant(region, "editor")]),
        orgId: region,
        permission: "messages.send",
        db,
      }),
    ).resolves.toEqual({
      success: true,
      orgId: region,
      roleName: "editor",
      mode: "direct-permission",
    });
  });

  it("grants through a role on an ancestor org", async () => {
    const sector = orgs.sector.id;
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([grant(sector, "admin")]),
        orgId: orgs.territoryBranch.ao.id,
        permission: "security.manage",
        db,
      }),
    ).resolves.toEqual({
      success: true,
      orgId: sector,
      roleName: "admin",
      mode: "org-admin",
    });
  });

  it.each([
    ["editor", "security.manage"],
    ["user", "messages.send"],
  ] as const)(
    "rejects a %s role, whose map lacks %s",
    async (roleName, permission) => {
      const region = orgs.directBranch.region.id;
      await expect(
        checkHasPermissionOnOrg({
          session: makeSession([grant(region, roleName)]),
          orgId: region,
          permission,
          db,
        }),
      ).resolves.toEqual({
        success: false,
        orgId: region,
        roleName: null,
        mode: "no-permission",
      });
    },
  );

  it("rejects a grant on an unrelated org", async () => {
    const target = orgs.directBranch.region.id;
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([grant(orgs.unrelatedSector.id, "admin")]),
        orgId: target,
        permission: "messages.send",
        db,
      }),
    ).resolves.toEqual({
      success: false,
      orgId: target,
      roleName: null,
      mode: "no-permission",
    });
  });

  it("checks an API-key session's own roles", async () => {
    const region = orgs.directBranch.region.id;
    const apiKeySession = makeSession([grant(orgs.sector.id, "editor")], true);
    await expect(
      checkHasPermissionOnOrg({
        session: apiKeySession,
        orgId: region,
        permission: "messages.send",
        db,
      }),
    ).resolves.toMatchObject({ success: true, mode: "org-admin" });
    await expect(
      checkHasPermissionOnOrg({
        session: apiKeySession,
        orgId: region,
        permission: "security.manage",
        db,
      }),
    ).resolves.toMatchObject({ success: false, mode: "no-permission" });
  });

  it("rejects when there is no session", async () => {
    await expect(
      checkHasPermissionOnOrg({
        session: null,
        orgId: orgs.directBranch.region.id,
        permission: "messages.send",
        db,
      }),
    ).resolves.toEqual({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });
  });
});
