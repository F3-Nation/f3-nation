/**
 * Org scoping for user.crupdate profile writes.
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
import { ERRORS } from "@acme/shared/app/errors";
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

describe("user.crupdate org scoping", () => {
  const createdUserIds: number[] = [];
  const createdOrgIds: number[] = [];
  let regionA: { id: number; name: string };
  let regionB: { id: number; name: string };

  const createRegion = async () => {
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Scope Region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!region) throw new Error("Failed to create region");
    createdOrgIds.push(region.id);
    return region;
  };

  const createUser = async (
    values: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `${uniqueId()}@example.com`,
        f3Name: "Original",
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

  const editorOf = (region: { id: number; name: string }) =>
    createEditorSession({ orgId: region.id, orgName: region.name });

  beforeAll(async () => {
    await getOrCreateRoles();
    regionA = await createRegion();
    regionB = await createRegion();
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

  it("rejects a profile write to a user with no home region and no role in the caller's orgs", async () => {
    const target = await createUser({ homeRegionId: null });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Hijacked",
        status: "inactive",
        homeRegionId: regionA.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const after = await readUser(target.id);
    expect(after?.f3Name).toBe("Original");
    expect(after?.status).toBe("active");
    expect(after?.homeRegionId).toBeNull();
  });

  it("writes the profile of a user with no home region who holds a role in the caller's org", async () => {
    const target = await createUser({ homeRegionId: null });
    await grantRole(target.id, regionA.id, "editor");
    await mockAuthWithSession(editorOf(regionA));

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Renamed",
      roles: [{ orgId: regionA.id, roleName: "editor" }],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Renamed");
  });

  it("rejects moving a user's home region into an org the caller can't edit", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
  });

  it("rejects creating a user homed in an org the caller can't edit", async () => {
    const email = `${uniqueId()}@example.com`;
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        email,
        f3Name: "Planted",
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const [created] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (created) createdUserIds.push(created.id);
    expect(created).toBeUndefined();
  });

  it("creates a user homed in an org the caller can edit", async () => {
    await mockAuthWithSession(editorOf(regionA));

    const created = await createTestClient().user.crupdate({
      email: `${uniqueId()}@example.com`,
      f3Name: "Welcome",
      homeRegionId: regionA.id,
      roles: [],
    });
    createdUserIds.push(created.id);

    expect(created.homeRegionId).toBe(regionA.id);
  });

  it("moves a user's home region when the caller edits both regions", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    const session = editorOf(regionA);
    const roles = [
      ...session.roles!,
      { orgId: regionB.id, orgName: regionB.name, roleName: "editor" as const },
    ];
    await mockAuthWithSession({ ...session, roles });

    await createTestClient().user.crupdate({
      id: target.id,
      homeRegionId: regionB.id,
      roles: [],
    });

    expect((await readUser(target.id))?.homeRegionId).toBe(regionB.id);
  });

  it("returns NOT_FOUND for an id that doesn't exist", async () => {
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: 2_000_000_000,
        f3Name: "Ghost",
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a signed-in user edit their own profile", async () => {
    const target = await createUser({ homeRegionId: regionB.id });
    await mockAuthWithSession({ ...editorOf(regionA), id: target.id });

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Me",
      roles: [],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Me");
  });

  it("lets a nation admin edit a user with no home region and no roles", async () => {
    const target = await createUser({ homeRegionId: null });
    await mockAuthWithSession(await createAdminSession());

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Renamed",
      roles: [],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Renamed");
  });

  it("ignores caller-supplied emailVerified", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(await createAdminSession());

    await createTestClient().user.crupdate({
      id: target.id,
      emailVerified: "2020-01-01T00:00:00Z",
      roles: [],
    });

    expect((await readUser(target.id))?.emailVerified).toBeNull();
  });

  it("does not treat an API key as its owner editing themselves", async () => {
    const owner = await createUser({ homeRegionId: regionB.id });
    const keySession: Session = {
      ...editorOf(regionA),
      id: owner.id,
      apiKey: {
        id: 1,
        key: "test...key",
        ownerId: owner.id,
        revokedAt: null,
        expiresAt: null,
        orgIds: [regionA.id],
      },
    };
    await mockAuthWithSession(keySession);

    await expect(
      createTestClient().user.crupdate({
        id: owner.id,
        f3Name: "Hijacked",
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(owner.id))?.f3Name).toBe("Original");
  });

  it("allows a role change that resends the unchanged profile it can't edit", async () => {
    const target = await createUser({ homeRegionId: null, firstName: null });
    const session = editorOf(regionA);
    const roles = [
      { orgId: regionA.id, orgName: regionA.name, roleName: "admin" as const },
    ];
    await mockAuthWithSession({ ...session, roles });

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Original",
      firstName: "",
      homeRegionId: null,
      status: "active",
      roles: [{ orgId: regionA.id, roleName: "editor" }],
    });

    const granted = await db
      .select()
      .from(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, target.id));
    expect(granted.map((role) => role.orgId)).toEqual([regionA.id]);
    expect((await readUser(target.id))?.firstName).toBeNull();
  });

  describe("PII from an admin of a role org outside the home region", () => {
    const setupPiiCase = async () => {
      const target = await createUser({
        homeRegionId: regionB.id,
        phone: "555-0100",
      });
      await grantRole(target.id, regionA.id, "editor");
      const session = editorOf(regionA);
      await mockAuthWithSession({
        ...session,
        roles: [
          {
            orgId: regionA.id,
            orgName: regionA.name,
            roleName: "admin" as const,
          },
        ],
      });
      return target;
    };

    it("rejects a PII change instead of dropping it", async () => {
      const target = await setupPiiCase();

      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          phone: "555-0199",
          roles: [{ orgId: regionA.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect((await readUser(target.id))?.phone).toBe("555-0100");
    });

    it("accepts PII resent unchanged", async () => {
      const target = await setupPiiCase();

      await createTestClient().user.crupdate({
        id: target.id,
        email: target.email.toUpperCase(),
        phone: "",
        roles: [{ orgId: regionA.id, roleName: "editor" }],
      });

      const after = await readUser(target.id);
      expect(after?.email).toBe(target.email);
      expect(after?.phone).toBe("555-0100");
    });
  });

  it("rejects a non-admin removing a role and writes nothing", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await grantRole(target.id, regionA.id, "editor");
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        roles: [],
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: ERRORS.MUST_BE_ADMIN_TO_REMOVE_ROLES,
    });

    const remaining = await db
      .select()
      .from(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, target.id));
    expect(remaining).toHaveLength(1);
    expect((await readUser(target.id))?.f3Name).toBe("Original");
  });

  it("leaves the profile untouched when a role change is rejected", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        roles: [{ orgId: regionA.id, roleName: "admin" }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(target.id))?.f3Name).toBe("Original");
  });
});
