import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { inArray, schema } from "@acme/db";
import { Permission, ROLE_PERMISSIONS } from "@acme/shared/app/permissions";
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
  const names = (role: UserRole) =>
    ROLE_PERMISSIONS[role].map(({ name }) => name).sort();

  it("gives admin every permission and editor no security or messages", () => {
    expect(names("admin")).toEqual([
      "entities.manage",
      "messages.send",
      "pii.read",
      "security.manage",
    ]);
    expect(names("editor")).toEqual(["entities.manage", "pii.read"]);
    expect(names("user")).toEqual([]);
    expect(names("password_manager")).toEqual([]);
    expect(names("password_reader")).toEqual([]);
  });

  it("only uses permissions defined in Permission", () => {
    const defined = new Set(Object.values(Permission));
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(defined.has(permission)).toBe(true);
      }
    }
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

  const role = (orgId: number, roleName: UserRole) => ({
    orgId,
    orgName: `org ${orgId}`,
    roleName,
  });

  it("allows a role on the org itself that includes the permission", async () => {
    const region = orgs.directBranch.region.id;
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([role(region, "editor")]),
        orgId: region,
        permission: Permission.EntitiesManage,
        db,
      }),
    ).resolves.toBe(true);
  });

  it("allows a role on an ancestor org", async () => {
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([role(orgs.sector.id, "admin")]),
        orgId: orgs.territoryBranch.ao.id,
        permission: Permission.SecurityManage,
        db,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    ["editor", Permission.MessagesSend.name, Permission.MessagesSend],
    ["editor", Permission.SecurityManage.name, Permission.SecurityManage],
    ["user", Permission.PiiRead.name, Permission.PiiRead],
  ] as const)(
    "rejects the %s role, which doesn't include %s",
    async (roleName, _name, permission) => {
      const region = orgs.directBranch.region.id;
      await expect(
        checkHasPermissionOnOrg({
          session: makeSession([role(region, roleName)]),
          orgId: region,
          permission,
          db,
        }),
      ).resolves.toBe(false);
    },
  );

  it("rejects a role on an unrelated org", async () => {
    await expect(
      checkHasPermissionOnOrg({
        session: makeSession([role(orgs.unrelatedSector.id, "admin")]),
        orgId: orgs.directBranch.region.id,
        permission: Permission.MessagesSend,
        db,
      }),
    ).resolves.toBe(false);
  });

  it("checks an API-key session's own roles", async () => {
    const region = orgs.directBranch.region.id;
    const apiKeySession = makeSession([role(orgs.sector.id, "editor")], true);
    await expect(
      checkHasPermissionOnOrg({
        session: apiKeySession,
        orgId: region,
        permission: Permission.EntitiesManage,
        db,
      }),
    ).resolves.toBe(true);
    await expect(
      checkHasPermissionOnOrg({
        session: apiKeySession,
        orgId: region,
        permission: Permission.SecurityManage,
        db,
      }),
    ).resolves.toBe(false);
  });

  it("rejects when there is no session", async () => {
    await expect(
      checkHasPermissionOnOrg({
        session: null,
        orgId: orgs.directBranch.region.id,
        permission: Permission.MessagesSend,
        db,
      }),
    ).resolves.toBe(false);
  });
});
