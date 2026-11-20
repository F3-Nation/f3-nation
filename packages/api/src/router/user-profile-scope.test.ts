/**
 * Who may edit a user's profile and read their PII through user.*: editors and
 * admins of the user's home region or an org above it, else of the nation.
 * A role on the caller's org gives the caller neither.
 *
 * These tests require TEST_DATABASE_URL to point at the seeded test database.
 */

import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import { eq, schema } from "@acme/db";
import type { OrgType } from "@acme/shared/app/enums";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

interface TestOrg {
  id: number;
  name: string;
}

describe("user profile and PII scope", () => {
  const createdUserIds: number[] = [];
  const createdOrgIds: number[] = [];
  let regionX: TestOrg;
  let regionY: TestOrg;

  const createOrg = async (orgType: OrgType, parentId: number) => {
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Profile Scope ${orgType} ${uniqueId()}`,
        orgType,
        parentId,
        isActive: true,
      })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!org) throw new Error(`Failed to create ${orgType}`);
    createdOrgIds.push(org.id);
    return org;
  };

  const createUser = async (
    values: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `${uniqueId()}@example.com`,
        f3Name: "Original",
        phone: "555-0100",
        emergencyPhone: "555-0111",
        ...values,
      })
      .returning();
    if (!user) throw new Error("Failed to create user");
    createdUserIds.push(user.id);
    return user;
  };

  const grantRole = async (
    userId: number,
    orgId: number,
    roleName: "editor" | "admin",
  ) => {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));
    if (!role) throw new Error(`Role ${roleName} not seeded`);
    await db
      .insert(schema.rolesXUsersXOrg)
      .values({ userId, orgId, roleId: role.id });
  };

  const readUser = async (id: number) => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  };

  const readRoleOrgIds = async (userId: number) =>
    (
      await db
        .select({ orgId: schema.rolesXUsersXOrg.orgId })
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, userId))
    ).map(({ orgId }) => orgId);

  const sessionWithRole = (
    org: TestOrg,
    roleName: "editor" | "admin",
  ): Session => {
    const roles = [{ orgId: org.id, orgName: org.name, roleName }];
    const session = createEditorSession({ orgId: org.id, orgName: org.name });
    return { ...session, roles, user: { ...session.user, roles } };
  };

  beforeAll(async () => {
    await getOrCreateRoles();
    const nation = await getOrCreateF3NationOrg();
    regionX = await createOrg("region", nation.id);
    regionY = await createOrg("region", nation.id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    for (const userId of createdUserIds.reverse()) {
      await cleanup.user(userId).catch(() => undefined);
    }
    for (const orgId of createdOrgIds.reverse()) {
      await cleanup.org(orgId).catch(() => undefined);
    }
  });

  describe("a user with no home region who holds a role on the caller's org", () => {
    const rolesAfterGrant = () => [
      { orgId: regionY.id, roleName: "admin" as const },
      { orgId: regionX.id, roleName: "editor" as const },
    ];

    // The caller grants the role themselves, as any org admin may.
    const grantRoleOnX = async (targetId: number) => {
      await createTestClient().user.crupdate({
        id: targetId,
        roles: rolesAfterGrant(),
      });
    };

    const setup = async () => {
      const target = await createUser({ homeRegionId: null });
      await grantRole(target.id, regionY.id, "admin");
      await mockAuthWithSession(sessionWithRole(regionX, "admin"));
      await grantRoleOnX(target.id);
      expect(await readRoleOrgIds(target.id)).toContain(regionX.id);
      return target;
    };

    it("rejects an email change by the admin who granted the role", async () => {
      const target = await setup();

      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          email: `taken-${uniqueId()}@example.com`,
          roles: rolesAfterGrant(),
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect((await readUser(target.id))?.email).toBe(target.email);
    });

    it("rejects homing the user in the caller's region", async () => {
      const target = await setup();

      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          homeRegionId: regionX.id,
          roles: rolesAfterGrant(),
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect((await readUser(target.id))?.homeRegionId).toBeNull();
    });

    it("withholds PII from byId", async () => {
      const target = await setup();

      const result = await createTestClient().user.byId({
        id: target.id,
        includePii: true,
      });

      expect(result.includePii).toBe(false);
      expect(result.user?.id).toBe(target.id);
      expect(result.user?.email).toBeUndefined();
      expect(result.user?.phone).toBeUndefined();
    });

    it("lets a nation admin edit the profile and read PII", async () => {
      const target = await setup();
      await mockAuthWithSession(await createAdminSession());
      const client = createTestClient();

      await client.user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        roles: rolesAfterGrant(),
      });
      const result = await client.user.byId({
        id: target.id,
        includePii: true,
      });

      expect((await readUser(target.id))?.f3Name).toBe("Renamed");
      expect(result.includePii).toBe(true);
      expect(result.user?.phone).toBe("555-0100");
    });
  });

  describe("a user homed in another region who holds a role on the caller's org", () => {
    const setup = async () => {
      const target = await createUser({ homeRegionId: regionY.id });
      await grantRole(target.id, regionX.id, "editor");
      await mockAuthWithSession(sessionWithRole(regionX, "admin"));
      return target;
    };

    it("returns no PII from a role-only crupdate", async () => {
      const target = await setup();

      const result = await createTestClient().user.crupdate({
        id: target.id,
        roles: [{ orgId: regionX.id, roleName: "admin" }],
      });

      expect(result.id).toBe(target.id);
      expect(result.email).toBeUndefined();
      expect(result.phone).toBeUndefined();
      expect(result.emergencyPhone).toBeUndefined();
    });

    it("withholds PII from byId", async () => {
      const target = await setup();

      const result = await createTestClient().user.byId({
        id: target.id,
        includePii: true,
      });

      expect(result.includePii).toBe(false);
      expect(result.user?.email).toBeUndefined();
      expect(result.user?.phone).toBeUndefined();
    });

    it("returns only the searched email from byEmail", async () => {
      const target = await setup();
      await db
        .update(schema.users)
        .set({ emailVerified: new Date().toISOString() })
        .where(eq(schema.users.id, target.id));

      const result = await createTestClient().user.byEmail({
        email: target.email,
        includePii: true,
      });

      expect(result.includePii).toBe(false);
      expect(result.user?.email).toBe(target.email);
      expect(result.user?.emailVerified).toBeUndefined();
      expect(result.user?.phone).toBeUndefined();
    });

    it("still lets the org's admin remove the role", async () => {
      const target = await setup();

      await createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Original",
        homeRegionId: regionY.id,
        roles: [],
      });

      expect(await readRoleOrgIds(target.id)).toEqual([]);
    });
  });

  describe("byOrgs with includePii", () => {
    const setup = async () => {
      const marker = uniqueId();
      const homed = await createUser({
        homeRegionId: regionX.id,
        f3Name: `Homed ${marker}`,
        email: `a-homed-${marker}@example.com`,
        phone: "555-0200",
      });
      const roleOnly = await createUser({
        homeRegionId: regionY.id,
        f3Name: `RoleOnly ${marker}`,
        email: `b-roleonly-${marker}@example.com`,
        phone: "555-0222",
      });
      const alsoHomed = await createUser({
        homeRegionId: regionX.id,
        f3Name: `AlsoHomed ${marker}`,
        email: `c-homed-${marker}@example.com`,
        phone: "555-0233",
      });
      await grantRole(roleOnly.id, regionX.id, "editor");
      await mockAuthWithSession(sessionWithRole(regionX, "admin"));
      return { marker, homed, roleOnly, alsoHomed };
    };

    it("returns PII only for users homed in the requested orgs", async () => {
      const { marker, homed, roleOnly } = await setup();

      const list = await createTestClient().user.byOrgs({
        orgIds: [regionX.id],
        includePii: true,
        searchTerm: marker,
        pageSize: 100,
      });

      expect(list.includePii).toBe(true);
      const homedRow = list.users.find((user) => user.id === homed.id);
      expect(homedRow?.piiVisible).toBe(true);
      expect(homedRow?.phone).toBe("555-0200");
      expect(homedRow?.email).toBe(homed.email);
      const roleOnlyRow = list.users.find((user) => user.id === roleOnly.id);
      expect(roleOnlyRow?.f3Name).toBe(roleOnly.f3Name);
      expect(roleOnlyRow?.piiVisible).toBe(false);
      expect(roleOnlyRow?.phone).toBeUndefined();
      expect(roleOnlyRow?.email).toBeUndefined();
      expect(roleOnlyRow?.emergencyPhone).toBeUndefined();
    });

    it("does not match a hidden email by partial search", async () => {
      const { marker, homed, roleOnly } = await setup();
      const client = createTestClient();

      const hidden = await client.user.byOrgs({
        orgIds: [regionX.id],
        includePii: true,
        searchTerm: `b-roleonly-${marker}`,
        pageSize: 100,
      });
      const visible = await client.user.byOrgs({
        orgIds: [regionX.id],
        includePii: true,
        searchTerm: `a-homed-${marker}`,
        pageSize: 100,
      });

      expect(hidden.users.map((user) => user.id)).not.toContain(roleOnly.id);
      expect(visible.users.map((user) => user.id)).toEqual([homed.id]);
    });

    it("does not order a hidden email among the visible ones", async () => {
      const { marker, homed, roleOnly, alsoHomed } = await setup();

      const list = await createTestClient().user.byOrgs({
        orgIds: [regionX.id],
        includePii: true,
        searchTerm: marker,
        sorting: [{ id: "email", desc: false }],
        pageSize: 100,
      });

      const ids = list.users.map((user) => user.id);
      expect(ids).toHaveLength(3);
      expect(ids.indexOf(homed.id)).toBeLessThan(ids.indexOf(alsoHomed.id));
      expect(ids.indexOf(roleOnly.id)).not.toBe(1);
    });

    it("returns PII for every user when the nation is requested", async () => {
      const marker = uniqueId();
      const noHomeRegion = await createUser({
        homeRegionId: null,
        f3Name: `NoHome ${marker}`,
      });
      await grantRole(noHomeRegion.id, regionX.id, "editor");
      const nation = await getOrCreateF3NationOrg();
      await mockAuthWithSession(await createAdminSession());

      const list = await createTestClient().user.byOrgs({
        orgIds: [nation.id],
        includePii: true,
        searchTerm: marker,
        pageSize: 100,
      });

      const row = list.users.find((user) => user.id === noHomeRegion.id);
      expect(row?.piiVisible).toBe(true);
      expect(row?.phone).toBe("555-0100");
    });

    it("marks every row hidden when the caller is not an admin of the orgs", async () => {
      const { marker, homed } = await setup();
      await mockAuthWithSession(sessionWithRole(regionX, "editor"));

      const list = await createTestClient().user.byOrgs({
        orgIds: [regionX.id],
        includePii: true,
        searchTerm: marker,
        pageSize: 100,
      });

      expect(list.includePii).toBe(false);
      const homedRow = list.users.find((user) => user.id === homed.id);
      expect(homedRow?.piiVisible).toBe(false);
      expect(homedRow?.phone).toBeUndefined();
    });
  });

  describe("an org above the home region", () => {
    it("lets its editor edit the profile and read PII", async () => {
      const nation = await getOrCreateF3NationOrg();
      const area = await createOrg("area", nation.id);
      const region = await createOrg("region", area.id);
      const target = await createUser({ homeRegionId: region.id });
      await mockAuthWithSession(sessionWithRole(area, "editor"));
      const client = createTestClient();

      await client.user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        phone: "555-0199",
        roles: [],
      });
      const result = await client.user.byId({
        id: target.id,
        includePii: true,
      });

      const after = await readUser(target.id);
      expect(after?.f3Name).toBe("Renamed");
      expect(after?.phone).toBe("555-0199");
      expect(result.includePii).toBe(true);
      expect(result.user?.email).toBe(target.email);
    });

    it("lets its editor read PII through byEmail", async () => {
      const nation = await getOrCreateF3NationOrg();
      const area = await createOrg("area", nation.id);
      const region = await createOrg("region", area.id);
      const target = await createUser({
        homeRegionId: region.id,
        emailVerified: new Date().toISOString(),
      });
      await mockAuthWithSession(sessionWithRole(area, "editor"));

      const result = await createTestClient().user.byEmail({
        email: target.email,
        includePii: true,
      });

      const stored = await readUser(target.id);
      expect(stored?.emailVerified).toBeTruthy();
      expect(result.includePii).toBe(true);
      expect(result.user?.email).toBe(target.email);
      expect(result.user?.emailVerified).toBe(stored?.emailVerified);
      expect(result.user?.phone).toBe("555-0100");
    });
  });
});
