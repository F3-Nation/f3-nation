import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { inArray, schema } from "@acme/db";
import { OrgType } from "@acme/shared/app/enums";
import {
  Permission,
  ROLE_ORG_TYPES,
  ROLE_PERMISSIONS,
  roleAllowedOnOrgType,
  roleHasPermission,
} from "@acme/shared/app/permissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createMixedOrgTree,
  db,
  getOrCreateRoles,
} from "./__tests__/test-utils";
import { checkHasPermissionsOnOrg } from "./check-has-role-on-org";

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

  it("gives a role name it has no entry for no permissions", () => {
    expect(
      roleHasPermission("not_a_role" as UserRole, Permission.MessagesSend),
    ).toBe(false);
    expect(
      roleHasPermission("constructor" as UserRole, Permission.MessagesSend),
    ).toBe(false);
  });
});

describe("checkHasPermissionsOnOrg", () => {
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
      checkHasPermissionsOnOrg({
        session: makeSession([role(region, "editor")]),
        orgId: region,
        permissions: [Permission.EntitiesManage],
        db,
      }),
    ).resolves.toBe(true);
  });

  it("allows a role on an ancestor org", async () => {
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(orgs.sector.id, "admin")]),
        orgId: orgs.territoryBranch.ao.id,
        permissions: [Permission.SecurityManage],
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
        checkHasPermissionsOnOrg({
          session: makeSession([role(region, roleName)]),
          orgId: region,
          permissions: [permission],
          db,
        }),
      ).resolves.toBe(false);
    },
  );

  it("requires every listed permission", async () => {
    const region = orgs.directBranch.region.id;
    const both = [Permission.EntitiesManage, Permission.MessagesSend] as const;
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(region, "editor")]),
        orgId: region,
        permissions: both,
        db,
      }),
    ).resolves.toBe(false);
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(orgs.sector.id, "admin")]),
        orgId: region,
        permissions: both,
        db,
      }),
    ).resolves.toBe(true);
  });

  it("takes each permission from whichever role includes it", async () => {
    const region = orgs.directBranch.region.id;
    const session = makeSession([
      role(region, "user"),
      role(orgs.sector.id, "editor"),
    ]);
    // Give two roles one permission each, so the test doesn't depend on how
    // the real roles' permissions overlap.
    const map = ROLE_PERMISSIONS;
    const original = { user: map.user, editor: map.editor };
    map.user = [Permission.EntitiesManage];
    map.editor = [Permission.PiiRead];
    try {
      // Neither role is enough alone. With the real role map, editor on the
      // sector holds both, so this fails if the override stops taking effect.
      const need = [Permission.EntitiesManage, Permission.PiiRead] as const;
      await expect(
        checkHasPermissionsOnOrg({
          session: makeSession([role(region, "user")]),
          orgId: region,
          permissions: need,
          db,
        }),
      ).resolves.toBe(false);
      await expect(
        checkHasPermissionsOnOrg({
          session: makeSession([role(orgs.sector.id, "editor")]),
          orgId: region,
          permissions: need,
          db,
        }),
      ).resolves.toBe(false);
      await expect(
        checkHasPermissionsOnOrg({
          session,
          orgId: region,
          permissions: [Permission.EntitiesManage, Permission.PiiRead],
          db,
        }),
      ).resolves.toBe(true);
      await expect(
        checkHasPermissionsOnOrg({
          session,
          orgId: region,
          permissions: [
            Permission.EntitiesManage,
            Permission.PiiRead,
            Permission.MessagesSend,
          ],
          db,
        }),
      ).resolves.toBe(false);
    } finally {
      map.user = original.user;
      map.editor = original.editor;
    }
  });

  it("rejects a role on an unrelated org", async () => {
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(orgs.unrelatedSector.id, "admin")]),
        orgId: orgs.directBranch.region.id,
        permissions: [Permission.MessagesSend],
        db,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a role on an org below the target", async () => {
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(orgs.directBranch.ao.id, "admin")]),
        orgId: orgs.directBranch.region.id,
        permissions: [Permission.MessagesSend],
        db,
      }),
    ).resolves.toBe(false);
  });

  it("rejects an empty permission list", async () => {
    await expect(
      checkHasPermissionsOnOrg({
        session: makeSession([role(orgs.directBranch.region.id, "admin")]),
        orgId: orgs.directBranch.region.id,
        permissions: [] as unknown as [Permission],
        db,
      }),
    ).resolves.toBe(false);
  });

  it("checks an API-key session's own roles", async () => {
    const region = orgs.directBranch.region.id;
    const apiKeySession = makeSession([role(orgs.sector.id, "editor")], true);
    await expect(
      checkHasPermissionsOnOrg({
        session: apiKeySession,
        orgId: region,
        permissions: [Permission.EntitiesManage],
        db,
      }),
    ).resolves.toBe(true);
    await expect(
      checkHasPermissionsOnOrg({
        session: apiKeySession,
        orgId: region,
        permissions: [Permission.SecurityManage],
        db,
      }),
    ).resolves.toBe(false);
  });

  it("rejects when there is no session", async () => {
    await expect(
      checkHasPermissionsOnOrg({
        session: null,
        orgId: orgs.directBranch.region.id,
        permissions: [Permission.MessagesSend],
        db,
      }),
    ).resolves.toBe(false);
  });
});

describe("roleAllowedOnOrgType", () => {
  it("allows the password roles on regions only", () => {
    for (const role of ["password_manager", "password_reader"] as const) {
      expect(
        OrgType.filter((type) => roleAllowedOnOrgType(role, type)),
      ).toEqual(["region"]);
    }
  });

  it("allows an unrestricted role on every org type", () => {
    for (const role of ["admin", "editor", "user"] as const) {
      expect(Object.hasOwn(ROLE_ORG_TYPES, role)).toBe(false);
      expect(OrgType.every((type) => roleAllowedOnOrgType(role, type))).toBe(
        true,
      );
    }
  });

  it("doesn't read inherited object keys as a restriction", () => {
    expect(roleAllowedOnOrgType("toString" as UserRole, "region")).toBe(true);
  });
});
