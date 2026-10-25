/**
 * Tests for User Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 *
 * Run with: pnpm test --filter @acme/api
 *
 * Note: These tests use createRouterClient to test the endpoints through the oRPC router.
 * The auth system is mocked using vi.mock to control session behavior.
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());
type LogFn = (
  event: string,
  fields?: Record<string, unknown>,
  error?: unknown,
) => void;
const { logError, logWarn } = vi.hoisted(() => ({
  logError: vi.fn<LogFn>(),
  logWarn: vi.fn<LogFn>(),
}));

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../logger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logError,
  logWarn,
}));

import type { Session } from "@acme/auth";
import { and, authSchema, eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import type { UserRole } from "@acme/shared/app/enums";
import { ERRORS } from "@acme/shared/app/errors";
import { Client, Header } from "@acme/shared/common/enums";
import { CrupdateUserSchema } from "@acme/validators";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import { router } from "../index";

describe("User Router", () => {
  beforeAll(async () => {
    // Note: Database should be reset and seeded before running tests
    // Run: pnpm -C packages/db reset-test-db
    // Or set up test database manually
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset rate limiter to allow requests
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  const createTestClient = () => {
    return createRouterClient(router, {
      context: () =>
        Promise.resolve({
          reqHeaders: new Headers({
            [Header.Client]: Client.ORPC,
          }),
        }),
    });
  };

  const createRegionAdminSession = (params: {
    orgId: number;
    orgName: string;
  }): Session => ({
    id: 1,
    email: "region-admin@example.com",
    user: {
      id: "1",
      email: "region-admin@example.com",
      name: "RegionAdmin",
      roles: [
        { orgId: params.orgId, orgName: params.orgName, roleName: "admin" },
      ],
    },
    roles: [
      { orgId: params.orgId, orgName: params.orgName, roleName: "admin" },
    ],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  describe("all", () => {
    it("should return a list of users without PII by default", async () => {
      const client = createTestClient();
      const result = await client.user.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("users");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.users)).toBe(true);
      expect(result.includePii).toBe(false);

      // Check that users don't have phone fields when includePii is false
      if (result.users.length > 0) {
        const firstUser = result.users[0];
        expect(firstUser).not.toHaveProperty("phone");
      }
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.user.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.user.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.users.length).toBeLessThanOrEqual(2);
      expect(page2.users.length).toBeLessThanOrEqual(2);
      // Results should be different (unless there are fewer than 2 users)
      if (
        page1.totalCount > 2 &&
        page1.users.length > 0 &&
        page2.users.length > 0
      ) {
        expect(page1.users[0]?.id).not.toBe(page2.users[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeUsers = await client.user.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeUsers.users.every((u) => u.status === "active")).toBe(true);
    });

    it("should search by name", async () => {
      const client = createTestClient();
      const result = await client.user.all({
        searchTerm: "test",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should match search term in f3Name, firstName, or lastName
      result.users.forEach((user) => {
        const searchLower = "test".toLowerCase();
        const matchesF3Name =
          user.f3Name?.toLowerCase().includes(searchLower) ?? false;
        const matchesFirstName =
          user.firstName?.toLowerCase().includes(searchLower) ?? false;
        const matchesLastName =
          user.lastName?.toLowerCase().includes(searchLower) ?? false;
        const matches = matchesF3Name || matchesFirstName || matchesLastName;
        expect(matches).toBe(true);
      });
    });
  });

  describe.each(["all", "byOrgs"] as const)(
    "name sorting for %s",
    (endpoint) => {
      it.each([
        {
          direction: "ascending",
          desc: false,
          expectedOrder: [7, 9, 4, 2, 3, 8, 1, 5, 6, 0],
        },
        {
          direction: "descending",
          desc: true,
          expectedOrder: [0, 6, 5, 1, 2, 3, 8, 4, 7, 9],
        },
      ])(
        "sorts by displayed full name $direction before pagination",
        async ({ desc, expectedOrder }) => {
          const prefix = `FullNameSort-${uniqueId()}`;
          const fixtures = [
            {
              firstName: " \t\nJordan",
              lastName: "Aaron\r\n ",
              name: "Jordan Aaron",
            },
            { firstName: "Alex", lastName: "Zimmer", name: "Alex Zimmer" },
            { firstName: "Alex", lastName: "Baker", name: "Alex Baker" },
            { firstName: " \tAlex", lastName: "Baker\n ", name: "Alex Baker" },
            { firstName: "Aaron", lastName: "Zimmer", name: "Aaron Zimmer" },
            { firstName: null, lastName: "Baker", name: "Baker" },
            { firstName: "Cameron", lastName: null, name: "Cameron" },
            { firstName: null, lastName: null, name: "" },
            {
              firstName: "\u00a0\u2003Alex",
              lastName: "Baker\u2028\u2029\ufeff",
              name: "Alex Baker",
            },
            { firstName: "\t\n", lastName: "\u00a0\ufeff", name: "" },
          ];
          const createdUsers: { id: number; name: string }[] = [];
          let regionId: number | undefined;

          try {
            const f3Nation = await getOrCreateF3NationOrg();
            const [region] = await db
              .insert(schema.orgs)
              .values({
                name: prefix,
                orgType: "region",
                parentId: f3Nation.id,
                isActive: true,
              })
              .returning({ id: schema.orgs.id });
            if (!region) throw new Error("Failed to create sorting region");
            regionId = region.id;

            for (const [index, fixture] of fixtures.entries()) {
              const [user] = await db
                .insert(schema.users)
                .values({
                  email: `${prefix}-${index}@sorting.test`,
                  f3Name: `${prefix}-${index}`,
                  firstName: fixture.firstName,
                  lastName: fixture.lastName,
                  homeRegionId: region.id,
                })
                .returning({ id: schema.users.id });
              if (!user) throw new Error("Failed to create sorting user");
              createdUsers.push({ id: user.id, name: fixture.name });
            }

            await mockAuthWithSession(await createAdminSession());
            const client = createTestClient();
            const seenUsers: { id: number; name: string }[] = [];
            for (
              let pageIndex = 0;
              pageIndex < fixtures.length / 2;
              pageIndex++
            ) {
              const input = {
                searchTerm: prefix,
                sorting: [{ id: "name", desc }],
                pageIndex,
                pageSize: 2,
              };
              const result =
                endpoint === "all"
                  ? await client.user.all(input)
                  : await client.user.byOrgs({
                      ...input,
                      orgIds: [region.id],
                    });

              expect(result.totalCount).toBe(fixtures.length);
              expect(result.users).toHaveLength(2);
              seenUsers.push(
                ...result.users.map(({ id, name }) => ({ id, name })),
              );
            }

            expect(seenUsers).toEqual(
              expectedOrder.map((index) => createdUsers[index]),
            );
          } finally {
            for (const user of createdUsers) {
              await cleanup.user(user.id);
            }
            if (regionId !== undefined) await cleanup.org(regionId);
          }
        },
      );
    },
  );

  describe("byOrgs", () => {
    it("should require at least one orgId", async () => {
      const client = createTestClient();
      await expect(
        client.user.byOrgs({
          orgIds: [],
          pageIndex: 0,
          pageSize: 10,
        }),
      ).rejects.toThrow();
    });

    it("should return users for specified organizations", async () => {
      const dbInstance = db;
      const client = createTestClient();

      // Get a test org ID (assuming test seed data exists)
      const [testOrg] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .limit(1);

      if (testOrg) {
        const result = await client.user.byOrgs({
          orgIds: [testOrg.id],
          pageIndex: 0,
          pageSize: 10,
        });

        expect(result).toHaveProperty("users");
        expect(result).toHaveProperty("totalCount");
        expect(Array.isArray(result.users)).toBe(true);
      }
    });

    it("should return empty array for non-existent org", async () => {
      const client = createTestClient();
      const result = await client.user.byOrgs({
        orgIds: [999999], // Non-existent org ID
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result.users).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe("byId", () => {
    it("should return a user by ID", async () => {
      const dbInstance = db;
      const client = createTestClient();

      // Get a test user ID
      const [testUser] = await dbInstance
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1);

      if (testUser) {
        const result = await client.user.byId({
          id: testUser.id,
          includePii: false,
        });

        expect(result).toHaveProperty("user");
        expect(result.user).toBeDefined();
        expect(result.user?.id).toBe(testUser.id);
        expect(result.includePii).toBe(false);

        // Should not have PII fields when includePii is false
        expect(result.user).not.toHaveProperty("phone");
      }
    });

    it("should return homeRegionId, avatarUrl, meta, homeRegion, and positions", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const regionName = `ByIdFieldsRegion-${uniqueId()}`;
      const createdIds: {
        userId?: number;
        regionId?: number;
        positionId?: number;
      } = {};

      try {
        const [region] = await db
          .insert(schema.orgs)
          .values({
            name: regionName,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!region) throw new Error("Failed to create region");
        createdIds.regionId = region.id;

        const [position] = await db
          .insert(schema.positions)
          .values({ name: `Pos-${uniqueId()}`, orgType: "region" })
          .returning();
        if (!position) throw new Error("Failed to create position");
        createdIds.positionId = position.id;

        const email = `byid-fields-${uniqueId()}@example.com`;
        const [user] = await db
          .insert(schema.users)
          .values({
            email,
            f3Name: "FieldsTest",
            homeRegionId: region.id,
            avatarUrl: "https://example.com/avatar.png",
          })
          .returning();
        if (!user) throw new Error("Failed to create user");
        createdIds.userId = user.id;

        await db.insert(schema.positionsXOrgsXUsers).values({
          positionId: position.id,
          orgId: region.id,
          userId: user.id,
        });

        const client = createTestClient();
        const result = await client.user.byId({
          id: user.id,
          includePii: false,
        });

        expect(result.user).not.toBeNull();
        expect(result.user).toHaveProperty("homeRegionId", region.id);
        expect(result.user).toHaveProperty(
          "avatarUrl",
          "https://example.com/avatar.png",
        );
        expect(result.user).toHaveProperty("meta");
        expect(result.user?.homeRegion).toEqual({
          homeRegionId: region.id,
          homeRegionName: regionName,
        });
        expect(result.user?.positions).toEqual([
          {
            positionId: position.id,
            positionName: position.name,
            orgId: region.id,
            orgName: regionName,
          },
        ]);
      } finally {
        if (createdIds.userId) {
          await db
            .delete(schema.positionsXOrgsXUsers)
            .where(eq(schema.positionsXOrgsXUsers.userId, createdIds.userId));
          await cleanup.user(createdIds.userId);
        }
        if (createdIds.positionId) {
          await db
            .delete(schema.positions)
            .where(eq(schema.positions.id, createdIds.positionId));
        }
        if (createdIds.regionId) {
          await cleanup.org(createdIds.regionId);
        }
      }
    });

    it("should return null for non-existent user", async () => {
      const client = createTestClient();
      const result = await client.user.byId({
        id: 999999, // Non-existent user ID
        includePii: false,
      });

      expect(result.user).toBeNull();
    });

    it("should handle string ID input (coercion)", async () => {
      const client = createTestClient();

      const [testUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1);

      if (testUser) {
        // Test that string IDs are coerced to numbers
        const result = await client.user.byId({
          id: String(testUser.id), // Simulate coercion (v4 coerce input is unknown)
          includePii: false,
        });

        expect(result.user?.id).toBe(testUser.id);
      }
    });

    it("should return the user's home region details", async () => {
      const client = createTestClient();

      const [testUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1);
      const [testRegion] = await db
        .select({ id: schema.orgs.id, name: schema.orgs.name })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "region"))
        .limit(1);

      if (!testUser || !testRegion) {
        return;
      }

      await db
        .update(schema.users)
        .set({ homeRegionId: testRegion.id })
        .where(eq(schema.users.id, testUser.id));

      const result = await client.user.byId({
        id: testUser.id,
        includePii: false,
      });

      expect(result.user?.homeRegionId).toBe(testRegion.id);
      expect(result.user?.homeRegion).toEqual({
        homeRegionId: testRegion.id,
        homeRegionName: testRegion.name,
      });
    });

    it("should include PII for a user with no roles and no home region when requester is an F3 Nation admin", async () => {
      const email = `byid-no-roles-${uniqueId()}@example.com`;
      const [testUser] = await db
        .insert(schema.users)
        .values({ email, f3Name: "NoRolesById" })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(await createAdminSession());
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(true);
        expect(result.user?.email).toBe(email);
      } finally {
        await cleanup.user(testUser.id);
      }
    });

    it("should not include PII for a user with no roles and no home region when requester is only a region admin", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `ByIdPiiRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `byid-region-admin-${uniqueId()}@example.com`,
          f3Name: "NoRolesRegionAdmin",
        })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(
          createRegionAdminSession({ orgId: region.id, orgName: region.name }),
        );
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(false);
        expect(result.user?.email).toBeUndefined();
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
      }
    });

    it("should include PII for a user with no roles when requester is an editor of the user's home region", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `ByIdHomeRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const email = `byid-home-editor-${uniqueId()}@example.com`;
      const [testUser] = await db
        .insert(schema.users)
        .values({ email, f3Name: "HomeRegionEditor", homeRegionId: region.id })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(
          createEditorSession({ orgId: region.id, orgName: region.name }),
        );
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(true);
        expect(result.user?.email).toBe(email);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
      }
    });

    it("should include PII for a user with no roles when requester is an admin of an org above the user's home region", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [area] = await db
        .insert(schema.orgs)
        .values({
          name: `ByIdPiiArea-${uniqueId()}`,
          orgType: "area",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!area) throw new Error("Failed to create test area");
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `ByIdPiiAreaRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: area.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const email = `byid-area-admin-${uniqueId()}@example.com`;
      const [testUser] = await db
        .insert(schema.users)
        .values({ email, f3Name: "AreaAdminTarget", homeRegionId: region.id })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(
          createRegionAdminSession({ orgId: area.id, orgName: area.name }),
        );
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(true);
        expect(result.user?.email).toBe(email);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
        await cleanup.org(area.id);
      }
    });

    it("should not include PII when requester is an admin of a different region than the user's home region", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [homeRegion, otherRegion] = await db
        .insert(schema.orgs)
        .values([
          {
            name: `ByIdPiiHome-${uniqueId()}`,
            orgType: "region",
            isActive: true,
            parentId: f3Nation.id,
          },
          {
            name: `ByIdPiiOther-${uniqueId()}`,
            orgType: "region",
            isActive: true,
            parentId: f3Nation.id,
          },
        ])
        .returning();
      if (!homeRegion || !otherRegion)
        throw new Error("Failed to create test regions");
      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `byid-other-region-${uniqueId()}@example.com`,
          f3Name: "OtherRegionTarget",
          homeRegionId: homeRegion.id,
        })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(
          createRegionAdminSession({
            orgId: otherRegion.id,
            orgName: otherRegion.name,
          }),
        );
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(false);
        expect(result.user?.email).toBeUndefined();
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(homeRegion.id);
        await cleanup.org(otherRegion.id);
      }
    });

    it("should include PII when requester is an admin of an org the user has a role on outside their home region", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [homeRegion, roleRegion] = await db
        .insert(schema.orgs)
        .values([
          {
            name: `ByIdRoleOrgHome-${uniqueId()}`,
            orgType: "region",
            isActive: true,
            parentId: f3Nation.id,
          },
          {
            name: `ByIdRoleOrgRole-${uniqueId()}`,
            orgType: "region",
            isActive: true,
            parentId: f3Nation.id,
          },
        ])
        .returning();
      if (!homeRegion || !roleRegion)
        throw new Error("Failed to create test regions");
      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `byid-role-org-${uniqueId()}@example.com`,
          f3Name: "RoleOrgTarget",
          homeRegionId: homeRegion.id,
        })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");
      const [userRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));
      if (!userRole) throw new Error("editor role not seeded");
      await db.insert(schema.rolesXUsersXOrg).values({
        userId: testUser.id,
        roleId: userRole.id,
        orgId: roleRegion.id,
      });

      try {
        await mockAuthWithSession(
          createRegionAdminSession({
            orgId: roleRegion.id,
            orgName: roleRegion.name,
          }),
        );
        const client = createTestClient();

        const result = await client.user.byId({
          id: testUser.id,
          includePii: true,
        });

        expect(result.includePii).toBe(true);
        expect(result.user?.email).toBe(testUser.email);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(homeRegion.id);
        await cleanup.org(roleRegion.id);
      }
    });
  });

  describe("byEmail", () => {
    it("should return a user by email", async () => {
      const dbInstance = db;
      const client = createTestClient();

      // Get a test user with email
      const [testUser] = await dbInstance
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, "test@example.com"))
        .limit(1);

      // If no test user exists, skip this test
      if (!testUser?.email) {
        return;
      }

      const result = await client.user.byEmail({
        email: testUser.email,
        includePii: false,
      });

      expect(result).toHaveProperty("user");
      expect(result.user).not.toBeNull();
      expect(result.user?.id).toBe(testUser.id);
      // Email should always be included when searching by email
      expect(result.user).toHaveProperty("email");
    });

    it("should return homeRegionId, avatarUrl, meta, homeRegion, and positions", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const regionName = `ByEmailFieldsRegion-${uniqueId()}`;
      const createdIds: {
        userId?: number;
        regionId?: number;
        positionId?: number;
      } = {};

      try {
        const [region] = await db
          .insert(schema.orgs)
          .values({
            name: regionName,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!region) throw new Error("Failed to create region");
        createdIds.regionId = region.id;

        const [position] = await db
          .insert(schema.positions)
          .values({ name: `Pos-${uniqueId()}`, orgType: "region" })
          .returning();
        if (!position) throw new Error("Failed to create position");
        createdIds.positionId = position.id;

        const email = `byemail-fields-${uniqueId()}@example.com`;
        const [user] = await db
          .insert(schema.users)
          .values({
            email,
            f3Name: "EmailFieldsTest",
            homeRegionId: region.id,
            avatarUrl: "https://example.com/avatar2.png",
          })
          .returning();
        if (!user) throw new Error("Failed to create user");
        createdIds.userId = user.id;

        await db.insert(schema.positionsXOrgsXUsers).values({
          positionId: position.id,
          orgId: region.id,
          userId: user.id,
        });

        const client = createTestClient();
        const result = await client.user.byEmail({
          email,
          includePii: false,
        });

        expect(result.user).not.toBeNull();
        expect(result.user).toHaveProperty("homeRegionId", region.id);
        expect(result.user).toHaveProperty(
          "avatarUrl",
          "https://example.com/avatar2.png",
        );
        expect(result.user).toHaveProperty("meta");
        expect(result.user?.homeRegion).toEqual({
          homeRegionId: region.id,
          homeRegionName: regionName,
        });
        expect(result.user?.positions).toEqual([
          {
            positionId: position.id,
            positionName: position.name,
            orgId: region.id,
            orgName: regionName,
          },
        ]);
      } finally {
        if (createdIds.userId) {
          await db
            .delete(schema.positionsXOrgsXUsers)
            .where(eq(schema.positionsXOrgsXUsers.userId, createdIds.userId));
          await cleanup.user(createdIds.userId);
        }
        if (createdIds.positionId) {
          await db
            .delete(schema.positions)
            .where(eq(schema.positions.id, createdIds.positionId));
        }
        if (createdIds.regionId) {
          await cleanup.org(createdIds.regionId);
        }
      }
    });

    it("should return null for non-existent email", async () => {
      const client = createTestClient();
      const result = await client.user.byEmail({
        email: "nonexistent@example.com",
        includePii: false,
      });

      expect(result.user).toBeNull();
    });

    it("should validate email format", async () => {
      const client = createTestClient();
      await expect(
        client.user.byEmail({
          email: "invalid-email",
          includePii: false,
        }),
      ).rejects.toThrow();
    });
  });

  describe("byF3Name", () => {
    it("should support pagination inputs", async () => {
      const client = createTestClient();
      const firstPage = await client.user.byF3Name({
        f3Name: "o",
        pageIndex: 0,
        pageSize: 1,
      });
      const secondPage = await client.user.byF3Name({
        f3Name: "o",
        pageIndex: 1,
        pageSize: 1,
      });

      expect(firstPage.users.length).toBeLessThanOrEqual(1);
      expect(secondPage.users.length).toBeLessThanOrEqual(1);
      expect(firstPage.totalCount).toBeGreaterThanOrEqual(
        firstPage.users.length,
      );
      expect(secondPage.totalCount).toBeGreaterThanOrEqual(
        secondPage.users.length,
      );
      expect(secondPage.totalCount).toBe(firstPage.totalCount);
      if (
        firstPage.totalCount > 1 &&
        firstPage.users.length > 0 &&
        secondPage.users.length > 0
      ) {
        expect(firstPage.users[0]?.id).not.toBe(secondPage.users[0]?.id);
      }
    });
  });

  describe("crupdate", () => {
    it("should create a new user with required fields", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org for admin role (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Get a test org for the role - use F3 Nation since admin has permission on it
      const newUserEmail = `test-${Date.now()}@example.com`;
      const result = await client.user.crupdate({
        email: newUserEmail,
        f3Name: "TestUser",
        firstName: "Test",
        lastName: "User",
        roles: [
          {
            orgId: f3Nation.id,
            roleName: "editor",
          },
        ],
      });

      expect(result).toHaveProperty("id");
      expect(result.email).toBe(newUserEmail);
      expect(result.f3Name).toBe("TestUser");
      expect(result.roles).toBeDefined();

      // Clean up - delete roles first due to FK constraint
      await dbInstance
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, result.id));
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, result.id));
    });

    it("should require email for new users", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();
      await expect(
        client.user.crupdate({
          f3Name: "TestUser",
          roles: [],
        }),
      ).rejects.toThrow("Email is required");
    });

    it("should validate email format", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();
      await expect(
        client.user.crupdate({
          email: "invalid-email",
          f3Name: "TestUser",
          roles: [],
        }),
      ).rejects.toThrow();
    });

    it("should update an existing user", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Create a test user first
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `update-test-${Date.now()}@example.com`,
          f3Name: "OriginalName",
          firstName: "Original",
          lastName: "Name",
        })
        .returning();

      if (!testUser) {
        return;
      }

      // Update the user
      const result = await client.user.crupdate({
        id: testUser.id,
        f3Name: "UpdatedName",
        firstName: "Updated",
        lastName: "Name",
        roles: [],
      });

      expect(result.id).toBe(testUser.id);
      expect(result.f3Name).toBe("UpdatedName");
      expect(result.firstName).toBe("Updated");

      // Clean up
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, testUser.id));
    });

    it("should prevent duplicate emails", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Get an existing user's email
      const [existingUser] = await dbInstance
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, "test@example.com"))
        .limit(1);

      if (!existingUser?.email) {
        return; // Skip if no existing user
      }

      await expect(
        client.user.crupdate({
          email: existingUser.email,
          f3Name: "DuplicateTest",
          roles: [],
        }),
      ).rejects.toThrow("already exists");
    });

    it("should allow role changes that resend the unchanged profile when admin does not manage user's home region", async () => {
      const dbInstance = db;

      // Create two region orgs
      const [regionA] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `RegionA-${Date.now()}`,
          orgType: "region",
          isActive: true,
        })
        .returning();
      const [regionB] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `RegionB-${Date.now()}`,
          orgType: "region",
          isActive: true,
        })
        .returning();

      if (!regionA || !regionB)
        throw new Error("Failed to create test regions");

      // Create a user with homeRegionId = regionB
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `hr-test-${Date.now()}@example.com`,
          f3Name: "HomeRegionTest",
          homeRegionId: regionB.id,
        })
        .returning();

      if (!testUser) throw new Error("Failed to create test user");

      // Mock session as admin of regionA only
      const mockSession: Session = {
        id: 1,
        email: "admin-a@example.com",
        user: {
          id: "1",
          email: "admin-a@example.com",
          name: "AdminA",
          roles: [
            { orgId: regionA.id, orgName: regionA.name, roleName: "admin" },
          ],
        },
        roles: [
          { orgId: regionA.id, orgName: regionA.name, roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Should succeed — the profile is resent unchanged, roles are processed
      const result = await client.user.crupdate({
        id: testUser.id,
        f3Name: "HomeRegionTest",
        roles: [{ orgId: regionA.id, roleName: "admin" }],
      });

      // Profile data should NOT have been modified
      expect(result.id).toBe(testUser.id);
      expect(result.f3Name).toBe("HomeRegionTest");

      // Role on regionA should have been granted
      const grantedRoles = await dbInstance
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, testUser.id));
      expect(grantedRoles.some((r) => r.orgId === regionA.id)).toBe(true);

      // Clean up
      await dbInstance
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, testUser.id));
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, testUser.id));
      await dbInstance
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, regionA.id));
      await dbInstance
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, regionB.id));
    });

    it("should reject profile changes and grant nothing when admin does not manage user's home region", async () => {
      const dbInstance = db;

      const [regionA] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `RegionA-${Date.now()}`,
          orgType: "region",
          isActive: true,
        })
        .returning();
      const [regionB] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `RegionB-${Date.now()}`,
          orgType: "region",
          isActive: true,
        })
        .returning();

      if (!regionA || !regionB)
        throw new Error("Failed to create test regions");

      const originalF3Name = "OriginalName";
      const originalFirstName = "OriginalFirst";
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `profile-guard-${Date.now()}@example.com`,
          f3Name: originalF3Name,
          firstName: originalFirstName,
          homeRegionId: regionB.id,
        })
        .returning();

      if (!testUser) throw new Error("Failed to create test user");

      const mockSession: Session = {
        id: 1,
        email: "admin-a@example.com",
        user: {
          id: "1",
          email: "admin-a@example.com",
          name: "AdminA",
          roles: [
            { orgId: regionA.id, orgName: regionA.name, roleName: "admin" },
          ],
        },
        roles: [
          { orgId: regionA.id, orgName: regionA.name, roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Attempt to modify profile fields and add a role on regionA
      await expect(
        client.user.crupdate({
          id: testUser.id,
          f3Name: "AttemptedChange",
          firstName: "AttemptedFirst",
          roles: [{ orgId: regionA.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // Verify directly in DB that profile wasn't modified
      const [dbUser] = await dbInstance
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, testUser.id));
      expect(dbUser?.f3Name).toBe(originalF3Name);
      expect(dbUser?.firstName).toBe(originalFirstName);

      // The rejected request must not grant the role either
      const grantedRoles = await dbInstance
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, testUser.id));
      expect(grantedRoles).toEqual([]);

      // Clean up
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, testUser.id));
      await dbInstance
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, regionA.id));
      await dbInstance
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, regionB.id));
    });

    it("should allow update when user has null home region but a role in the caller's region", async () => {
      const dbInstance = db;

      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({ name: "F3 Nation", orgType: "nation", isActive: true })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) throw new Error("F3 Nation org not found");

      // Create a region for the admin
      const [region] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `Region-${Date.now()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();

      if (!region) throw new Error("Failed to create test region");

      // Create a user with no home region
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `null-hr-${Date.now()}@example.com`,
          f3Name: "NullHomeRegion",
          homeRegionId: null,
        })
        .returning();

      if (!testUser) throw new Error("Failed to create test user");

      const [editorRole] = await dbInstance
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));
      if (!editorRole) throw new Error("Editor role not seeded");
      await dbInstance.insert(schema.rolesXUsersXOrg).values({
        userId: testUser.id,
        orgId: region.id,
        roleId: editorRole.id,
      });

      // Mock session as admin of the region (not nation)
      const mockSession: Session = {
        id: 1,
        email: "region-admin@example.com",
        user: {
          id: "1",
          email: "region-admin@example.com",
          name: "RegionAdmin",
          roles: [
            { orgId: region.id, orgName: region.name, roleName: "admin" },
          ],
        },
        roles: [{ orgId: region.id, orgName: region.name, roleName: "admin" }],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      const result = await client.user.crupdate({
        id: testUser.id,
        f3Name: "Updated",
        roles: [],
      });

      expect(result.id).toBe(testUser.id);
      expect(result.f3Name).toBe("Updated");

      // Clean up
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, testUser.id));
      await dbInstance.delete(schema.orgs).where(eq(schema.orgs.id, region.id));
    });

    it("should allow update when admin manages user's home region", async () => {
      const dbInstance = db;

      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({ name: "F3 Nation", orgType: "nation", isActive: true })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) throw new Error("F3 Nation org not found");

      // Create a region
      const [region] = await dbInstance
        .insert(schema.orgs)
        .values({
          name: `Region-${Date.now()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();

      if (!region) throw new Error("Failed to create test region");

      // Create a user with homeRegionId set to this region
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `same-hr-${Date.now()}@example.com`,
          f3Name: "SameHomeRegion",
          homeRegionId: region.id,
        })
        .returning();

      if (!testUser) throw new Error("Failed to create test user");

      // Mock session as admin of that same region
      const mockSession: Session = {
        id: 1,
        email: "region-admin@example.com",
        user: {
          id: "1",
          email: "region-admin@example.com",
          name: "RegionAdmin",
          roles: [
            { orgId: region.id, orgName: region.name, roleName: "admin" },
          ],
        },
        roles: [{ orgId: region.id, orgName: region.name, roleName: "admin" }],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      const result = await client.user.crupdate({
        id: testUser.id,
        f3Name: "UpdatedByRegionAdmin",
        roles: [],
      });

      expect(result.id).toBe(testUser.id);
      expect(result.f3Name).toBe("UpdatedByRegionAdmin");

      // Clean up
      await dbInstance
        .delete(schema.users)
        .where(eq(schema.users.id, testUser.id));
      await dbInstance.delete(schema.orgs).where(eq(schema.orgs.id, region.id));
    });

    it("should let an editor of the user's home region update the email of a user with no roles", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `CrupdateHomeEditor-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `crupdate-home-editor-${uniqueId()}@example.com`,
          f3Name: "HomeEditorCrupdate",
          homeRegionId: region.id,
        })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");
      const newEmail = `crupdate-home-editor-new-${uniqueId()}@example.com`;

      try {
        await mockAuthWithSession(
          createEditorSession({ orgId: region.id, orgName: region.name }),
        );
        const client = createTestClient();

        await client.user.crupdate({
          id: testUser.id,
          f3Name: "HomeEditorCrupdate",
          email: newEmail,
          roles: [],
        });

        const [dbUser] = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));
        expect(dbUser?.email).toBe(newEmail);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
      }
    });

    it("should let an F3 Nation admin update the email of a user with no roles and no home region", async () => {
      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `crupdate-no-roles-${uniqueId()}@example.com`,
          f3Name: "NoRolesCrupdate",
        })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");
      const newEmail = `crupdate-no-roles-new-${uniqueId()}@example.com`;

      try {
        await mockAuthWithSession(await createAdminSession());
        const client = createTestClient();

        await client.user.crupdate({
          id: testUser.id,
          f3Name: "PiiUnchanged",
          email: newEmail,
          roles: [],
        });

        const [dbUser] = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));
        expect(dbUser?.email).toBe(newEmail);
      } finally {
        await cleanup.user(testUser.id);
      }
    });

    it.each([
      ["email", `crupdate-denied-new-${uniqueId()}@example.com`],
      ["phone", "555-0100"],
      ["phone", null],
      ["emergencyContact", "New Contact"],
      ["emergencyPhone", "555-0101"],
      ["emergencyNotes", "New notes"],
    ] as const)(
      "should reject a %s change to %s from a user editing themselves without PII access",
      async (field, value) => {
        const f3Nation = await getOrCreateF3NationOrg();
        const [region] = await db
          .insert(schema.orgs)
          .values({
            name: `CrupdatePiiRegion-${uniqueId()}`,
            orgType: "region",
            isActive: true,
            parentId: f3Nation.id,
          })
          .returning();
        if (!region) throw new Error("Failed to create test region");
        const stored = {
          email: `crupdate-denied-${uniqueId()}@example.com`,
          phone: "555-0199",
          emergencyContact: "Old Contact",
          emergencyPhone: "555-0198",
          emergencyNotes: "Old notes",
        };
        const [testUser] = await db
          .insert(schema.users)
          .values({ ...stored, f3Name: "PiiDenied" })
          .returning();
        if (!testUser) throw new Error("Failed to create test user");

        try {
          // Self-edits may change the profile, so only the PII check can
          // reject this. The editor role is on an unrelated region.
          await mockAuthWithSession({
            ...createEditorSession({ orgId: region.id, orgName: region.name }),
            id: testUser.id,
          });
          const client = createTestClient();

          await expect(
            client.user.crupdate({
              id: testUser.id,
              f3Name: "PiiDenied",
              roles: [],
              [field]: value,
            }),
          ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
            message: "You are not authorized to change this user's PII",
          });

          const [dbUser] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, testUser.id));
          expect(dbUser?.[field]).toBe(stored[field]);
        } finally {
          await cleanup.user(testUser.id);
          await cleanup.org(region.id);
        }
      },
    );

    it("should accept the user's current email when requester lacks PII access", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `CrupdateSameEmailRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const email = `crupdate-same-${uniqueId()}@example.com`;
      const [testUser] = await db
        .insert(schema.users)
        .values({ email, f3Name: "SameEmail" })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        await mockAuthWithSession(
          createRegionAdminSession({ orgId: region.id, orgName: region.name }),
        );
        const client = createTestClient();

        // The Manage Access window finds the user by email and sends that
        // same email back while granting a role
        const result = await client.user.crupdate({
          id: testUser.id,
          f3Name: "SameEmail",
          email: email.toUpperCase(),
          roles: [{ orgId: region.id, roleName: "editor" }],
        });

        expect(result.roles.some((r) => r.orgId === region.id)).toBe(true);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
      }
    });

    it("should treat an empty email as no change when requester lacks PII access", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `CrupdateEmptyEmailRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: f3Nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create test region");
      const originalEmail = `crupdate-empty-${uniqueId()}@example.com`;
      const [testUser] = await db
        .insert(schema.users)
        .values({ email: originalEmail, f3Name: "EmptyEmail" })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      try {
        // A self-edit may change the profile but has no PII access
        await mockAuthWithSession({
          ...createEditorSession({ orgId: region.id, orgName: region.name }),
          id: testUser.id,
        });
        const client = createTestClient();

        // The admin window sends email: "" when the PII fields are hidden
        const result = await client.user.crupdate({
          id: testUser.id,
          f3Name: "EmptyEmailUpdated",
          email: "",
          roles: [],
        });

        expect(result.f3Name).toBe("EmptyEmailUpdated");
        const [dbUser] = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));
        expect(dbUser?.email).toBe(originalEmail);
      } finally {
        await cleanup.user(testUser.id);
        await cleanup.org(region.id);
      }
    });
  });

  describe("delete", () => {
    it("should require F3 Nation admin role", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      // Mock session with editor role (not admin) on a different org
      const mockSession: Session = {
        id: 1,
        email: "editor@example.com",
        user: {
          id: "1",
          email: "editor@example.com",
          name: "Editor",
          roles: [
            {
              orgId: f3Nation.id + 999,
              orgName: "Test Org",
              roleName: "editor",
            },
          ],
        },
        roles: [
          { orgId: f3Nation.id + 999, orgName: "Test Org", roleName: "editor" },
        ], // Not admin, different org
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      const [testUser] = await dbInstance
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1);

      if (testUser) {
        // adminProcedure will throw UNAUTHORIZED before reaching the delete handler
        // since the user doesn't have admin role on any org
        await expect(
          client.user.delete({
            id: testUser.id,
          }),
        ).rejects.toThrow();
      }
    });

    it("should delete a user and their roles", async () => {
      const dbInstance = db;

      // Find or create F3 Nation org (must have name "F3 Nation")
      let [f3Nation] = await dbInstance
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3Nation) {
        const [created] = await dbInstance
          .insert(schema.orgs)
          .values({
            name: "F3 Nation",
            orgType: "nation",
            isActive: true,
          })
          .returning();
        f3Nation = created;
      }

      if (!f3Nation) {
        throw new Error("F3 Nation org not found");
      }

      const mockSession: Session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
          ],
        },
        roles: [
          { orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(mockSession);

      const client = createTestClient();

      // Create a test user with roles
      const [testUser] = await dbInstance
        .insert(schema.users)
        .values({
          email: `delete-test-${Date.now()}@example.com`,
          f3Name: "DeleteTest",
        })
        .returning();

      if (!testUser) {
        return;
      }

      try {
        // Add a role
        const [adminRole] = await dbInstance
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(eq(schema.roles.name, "admin"))
          .limit(1);

        if (adminRole) {
          await dbInstance.insert(schema.rolesXUsersXOrg).values({
            userId: testUser.id,
            orgId: f3Nation.id,
            roleId: adminRole.id,
          });
        }

        // A linked better_auth_user row must go with the user (ON DELETE CASCADE)
        await db.insert(authSchema.betterAuthUser).values({
          id: String(testUser.id),
          name: "DeleteTest",
          email: testUser.email,
        });

        // Delete the user
        await client.user.delete({
          id: testUser.id,
        });

        // Verify user is deleted
        const [deletedUser] = await dbInstance
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));

        expect(deletedUser).toBeUndefined();

        // Verify roles are deleted
        const roles = await dbInstance
          .select()
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, testUser.id));

        expect(roles).toHaveLength(0);

        const authUsers = await db
          .select()
          .from(authSchema.betterAuthUser)
          .where(eq(authSchema.betterAuthUser.id, String(testUser.id)));
        expect(authUsers).toHaveLength(0);
      } finally {
        // No-ops when the delete succeeded; removes leftovers when it did not.
        await db
          .delete(authSchema.betterAuthUser)
          .where(eq(authSchema.betterAuthUser.id, String(testUser.id)));
        await cleanup.user(testUser.id);
      }
    });

    it("should return CONFLICT and keep roles when the user has history", async () => {
      // The handler looks the nation up by name, and getOrCreateF3NationOrg
      // returns whichever nation org comes first, so match the handler.
      let [f3Nation] = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);
      f3Nation ??= (
        await db
          .insert(schema.orgs)
          .values({ name: "F3 Nation", orgType: "nation", isActive: true })
          .returning({ id: schema.orgs.id })
      )[0];
      if (!f3Nation) throw new Error("F3 Nation org not found");

      const adminRoles = [
        {
          orgId: f3Nation.id,
          orgName: "F3 Nation",
          roleName: "admin" as const,
        },
      ];
      await mockAuthWithSession({
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: adminRoles,
        },
        roles: adminRoles,
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });
      const client = createTestClient();

      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `delete-history-${uniqueId()}@example.com`,
          f3Name: "DeleteHistory",
        })
        .returning();
      if (!testUser) throw new Error("test user not created");

      let eventInstanceId: number | undefined;
      try {
        const [adminRole] = await db
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(eq(schema.roles.name, "admin"))
          .limit(1);
        if (!adminRole) throw new Error("admin role not seeded");

        await db.insert(schema.rolesXUsersXOrg).values({
          userId: testUser.id,
          orgId: f3Nation.id,
          roleId: adminRole.id,
        });

        // Attendance references users without ON DELETE CASCADE, so the users
        // delete fails with a foreign-key violation.
        const [eventInstance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Delete history ${uniqueId()}`,
            orgId: f3Nation.id,
            startDate: new Date().toISOString().split("T")[0]!,
            isActive: true,
            highlight: false,
          })
          .returning({ id: schema.eventInstances.id });
        if (!eventInstance) throw new Error("event instance not created");
        eventInstanceId = eventInstance.id;
        await db.insert(schema.attendance).values({
          eventInstanceId: eventInstance.id,
          userId: testUser.id,
          isPlanned: false,
        });

        await expect(
          client.user.delete({ id: testUser.id }),
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message:
            "This user has history (such as attendance or achievements) and can't be deleted.",
        });

        // The blocking constraint is logged so the cause is traceable.
        const blocked = logWarn.mock.calls.find(
          ([event]) => event === "api.user.delete_blocked",
        );
        expect(blocked?.[1]).toMatchObject({ userId: testUser.id });
        expect(typeof blocked?.[1]?.constraint).toBe("string");

        const [stillThere] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));
        expect(stillThere).toBeDefined();

        // The roles delete ran first in the same transaction; it must have
        // rolled back.
        const roles = await db
          .select()
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, testUser.id));
        expect(roles).toHaveLength(1);
      } finally {
        await db
          .delete(schema.attendance)
          .where(eq(schema.attendance.userId, testUser.id));
        if (eventInstanceId !== undefined) {
          await db
            .delete(schema.eventInstances)
            .where(eq(schema.eventInstances.id, eventInstanceId));
        }
        await cleanup.user(testUser.id);
      }
    });

    it("should return a generic error and keep the user on an unexpected failure", async () => {
      let [f3Nation] = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);
      f3Nation ??= (
        await db
          .insert(schema.orgs)
          .values({ name: "F3 Nation", orgType: "nation", isActive: true })
          .returning({ id: schema.orgs.id })
      )[0];
      if (!f3Nation) throw new Error("F3 Nation org not found");

      const adminRoles = [
        {
          orgId: f3Nation.id,
          orgName: "F3 Nation",
          roleName: "admin" as const,
        },
      ];
      await mockAuthWithSession({
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: adminRoles,
        },
        roles: adminRoles,
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });
      const client = createTestClient();

      const [testUser] = await db
        .insert(schema.users)
        .values({
          email: `delete-fault-${uniqueId()}@example.com`,
          f3Name: "DeleteFault",
        })
        .returning();
      if (!testUser) throw new Error("test user not created");

      // ctx.db is the lazy `db` proxy, which forwards every access to the
      // instance cached on globalThis.db outside production. Spy on that
      // instance so the handler's transaction call rejects.
      const realDb = globalThis.db;
      if (!realDb) throw new Error("db instance not initialised");
      const transactionSpy = vi
        .spyOn(realDb, "transaction")
        .mockRejectedValueOnce(new Error("boom"));

      try {
        const error: unknown = await client.user
          .delete({ id: testUser.id })
          .catch((e: unknown) => e);
        expect(error).toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to delete user",
        });
        expect((error as Error).message).not.toContain("boom");

        expect(logError).toHaveBeenCalledWith(
          "api.user.delete_failed",
          { userId: testUser.id },
          expect.objectContaining({ message: "boom" }),
        );

        const [stillThere] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, testUser.id));
        expect(stillThere).toBeDefined();
      } finally {
        transactionSpy.mockRestore();
        await cleanup.user(testUser.id);
      }
    });
  });

  describe("crupdate response PII", () => {
    const piiFields = [
      "email",
      "emailVerified",
      "phone",
      "emergencyContact",
      "emergencyPhone",
      "emergencyNotes",
    ] as const;

    const sessionWithRole = (
      org: { id: number; name: string },
      roleName: "editor" | "admin",
    ): Session => ({
      id: 1,
      email: "requester@example.com",
      user: {
        id: "1",
        email: "requester@example.com",
        name: "Requester",
        roles: [{ orgId: org.id, orgName: org.name, roleName }],
      },
      roles: [{ orgId: org.id, orgName: org.name, roleName }],
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    });

    const setup = async () => {
      const nation = await getOrCreateF3NationOrg();
      const [editorRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));
      if (!editorRole) throw new Error("editor role not seeded");

      const regions = await db
        .insert(schema.orgs)
        .values(
          ["Requester", "Target"].map((label) => ({
            name: `${label} Region ${uniqueId()}`,
            orgType: "region" as const,
            isActive: true,
            parentId: nation.id,
          })),
        )
        .returning({ id: schema.orgs.id, name: schema.orgs.name });
      const [requesterRegion, targetRegion] = regions;
      if (!requesterRegion || !targetRegion) {
        throw new Error("Failed to create regions");
      }

      const [target] = await db
        .insert(schema.users)
        .values({
          email: `pii-${uniqueId()}@example.com`,
          f3Name: "PiiTarget",
          phone: "555-0100",
          emergencyContact: "Contact",
          emergencyPhone: "555-0101",
          emergencyNotes: "Notes",
          homeRegionId: targetRegion.id,
        })
        .returning({ id: schema.users.id });
      if (!target) throw new Error("Failed to create target user");
      await db.insert(schema.rolesXUsersXOrg).values({
        userId: target.id,
        orgId: targetRegion.id,
        roleId: editorRole.id,
      });

      return {
        requesterRegion,
        targetRegion,
        targetId: target.id,
        teardown: async () => {
          await cleanup.user(target.id);
          for (const region of regions) await cleanup.org(region.id);
        },
      };
    };

    it("omits PII for an editor outside the target's orgs", async () => {
      const fixture = await setup();
      try {
        await mockAuthWithSession(
          sessionWithRole(fixture.requesterRegion, "editor"),
        );
        const result = await createTestClient().user.crupdate({
          id: fixture.targetId,
          roles: [{ orgId: fixture.targetRegion.id, roleName: "editor" }],
        });

        expect(result.id).toBe(fixture.targetId);
        for (const field of piiFields) {
          expect(result).not.toHaveProperty(field);
        }
      } finally {
        await fixture.teardown();
      }
    });

    it("returns PII to an editor on the target's home region", async () => {
      const fixture = await setup();
      try {
        await mockAuthWithSession(
          sessionWithRole(fixture.targetRegion, "editor"),
        );
        const result = await createTestClient().user.crupdate({
          id: fixture.targetId,
          roles: [{ orgId: fixture.targetRegion.id, roleName: "editor" }],
        });

        expect(result.phone).toBe("555-0100");
        expect(result.emergencyNotes).toBe("Notes");
      } finally {
        await fixture.teardown();
      }
    });

    it("omits PII when an editor creates a user", async () => {
      const fixture = await setup();
      let createdId: number | undefined;
      try {
        await mockAuthWithSession(
          sessionWithRole(fixture.requesterRegion, "editor"),
        );
        const result = await createTestClient().user.crupdate({
          email: `pii-new-${uniqueId()}@example.com`,
          f3Name: "PiiNew",
          phone: "555-0102",
          roles: [],
        });
        createdId = result.id;

        for (const field of piiFields) {
          expect(result).not.toHaveProperty(field);
        }
      } finally {
        if (createdId) await cleanup.user(createdId);
        await fixture.teardown();
      }
    });

    it("returns PII to an admin of the target's org", async () => {
      const fixture = await setup();
      try {
        await mockAuthWithSession(
          sessionWithRole(fixture.targetRegion, "admin"),
        );
        const result = await createTestClient().user.crupdate({
          id: fixture.targetId,
          roles: [{ orgId: fixture.targetRegion.id, roleName: "editor" }],
        });

        expect(result.phone).toBe("555-0100");
        expect(result.emergencyNotes).toBe("Notes");
      } finally {
        await fixture.teardown();
      }
    });
  });

  describe("dormant password roles", () => {
    // Rows created here are removed after each test, roles last, so a leftover
    // password_* roles row never leaks into other tests (none exists in prod).
    const created = {
      users: [] as number[],
      orgs: [] as number[],
      roles: [] as number[],
    };

    afterEach(async () => {
      for (const id of created.users.splice(0)) await cleanup.user(id);
      for (const id of created.orgs.splice(0)) await cleanup.org(id);
      for (const id of created.roles.splice(0))
        await db.delete(schema.roles).where(eq(schema.roles.id, id));
    });

    const nationAdminSession = (nation: {
      id: number;
      name: string | null;
    }): Session =>
      createRegionAdminSession({
        orgId: nation.id,
        orgName: nation.name ?? "F3 Nation",
      });

    const getOrCreateRole = async (name: UserRole) => {
      const [existing] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, name));
      if (existing) return existing.id;
      const [role] = await db
        .insert(schema.roles)
        .values({ name })
        .returning({ id: schema.roles.id });
      if (!role) throw new Error(`Failed to create ${name} role`);
      created.roles.push(role.id);
      return role.id;
    };

    const createRegion = async () => {
      const nation = await getOrCreateF3NationOrg();
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `DormantRegion-${uniqueId()}`,
          orgType: "region",
          isActive: true,
          parentId: nation.id,
        })
        .returning();
      if (!region) throw new Error("Failed to create region");
      created.orgs.push(region.id);
      return region;
    };

    const createUser = async (
      f3Name: string,
      assignments: { orgId: number; roleId: number }[] = [],
    ) => {
      const email = `dormant-${uniqueId()}@example.com`;
      const [user] = await db
        .insert(schema.users)
        .values({ email, f3Name })
        .returning({ id: schema.users.id });
      if (!user) throw new Error("Failed to create user");
      created.users.push(user.id);
      if (assignments.length)
        await db
          .insert(schema.rolesXUsersXOrg)
          .values(assignments.map((a) => ({ ...a, userId: user.id })));
      return { id: user.id, email };
    };

    const roleRows = async (userId: number) =>
      (
        await db
          .select({
            orgId: schema.rolesXUsersXOrg.orgId,
            roleId: schema.rolesXUsersXOrg.roleId,
          })
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, userId))
      ).sort((a, b) => a.orgId - b.orgId || a.roleId - b.roleId);

    it("rejects granting a dormant (non-grantable) role", async () => {
      const nation = await getOrCreateF3NationOrg();
      // With a password_manager roles row present, only the input schema
      // stands between this payload and a real grant.
      await getOrCreateRole("password_manager");
      const user = await createUser("DormantGrant");
      const payload = {
        id: user.id,
        email: user.email,
        roles: [{ orgId: nation.id, roleName: "password_manager" }],
      };

      expect(CrupdateUserSchema.safeParse(payload).success).toBe(false);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      await expect(
        // Cast past the narrowed input type to exercise runtime validation.
        client.user.crupdate(
          payload as Parameters<typeof client.user.crupdate>[0],
        ),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Input validation failed",
      });
      expect(await roleRows(user.id)).toEqual([]);
    });

    it("filters users by role, including role-less and dormant-role users", async () => {
      const nation = await getOrCreateF3NationOrg();
      const [editorId, adminId, pmId, userRoleId] = await Promise.all([
        getOrCreateRole("editor"),
        getOrCreateRole("admin"),
        getOrCreateRole("password_manager"),
        getOrCreateRole("user"),
      ]);
      const marker = `RoleFilter${uniqueId()}`;
      const roleLess = await createUser(`${marker}None`);
      const explicitUser = await createUser(`${marker}User`, [
        { orgId: nation.id, roleId: userRoleId },
      ]);
      const editor = await createUser(`${marker}Editor`, [
        { orgId: nation.id, roleId: editorId },
      ]);
      const admin = await createUser(`${marker}Admin`, [
        { orgId: nation.id, roleId: adminId },
      ]);
      const pm = await createUser(`${marker}Pm`, [
        { orgId: nation.id, roleId: pmId },
      ]);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      const matching = async (roles: UserRole[]) => {
        const result = await client.user.all({
          roles,
          searchTerm: marker,
          pageIndex: 0,
          pageSize: 50,
        });
        return new Set(result.users.map((u) => u.id));
      };

      expect(await matching(["user"])).toEqual(
        new Set([roleLess.id, explicitUser.id]),
      );
      expect(await matching(["editor"])).toEqual(new Set([editor.id]));
      expect(await matching(["editor", "admin"])).toEqual(
        new Set([editor.id, admin.id]),
      );
      expect(await matching(["user", "admin"])).toEqual(
        new Set([roleLess.id, explicitUser.id, admin.id]),
      );
      expect(await matching(["user", "editor", "admin"])).toEqual(
        new Set([roleLess.id, explicitUser.id, editor.id, admin.id]),
      );
      expect(await matching(["password_manager"])).toEqual(new Set([pm.id]));
    });

    it("preserves dormant role assignments when crupdate omits them", async () => {
      const nation = await getOrCreateF3NationOrg();
      const pmId = await getOrCreateRole("password_manager");
      const user = await createUser("PreserveMe", [
        { orgId: nation.id, roleId: pmId },
      ]);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      // The admin UI hides the dormant role, so crupdate submits none. The
      // assignment must survive instead of being treated as "removed".
      await client.user.crupdate({ id: user.id, email: user.email, roles: [] });

      expect(await roleRows(user.id)).toEqual([
        { orgId: nation.id, roleId: pmId },
      ]);
    });

    it("grants a role on another org while keeping a dormant role", async () => {
      const nation = await getOrCreateF3NationOrg();
      const [regionA, regionB] = [await createRegion(), await createRegion()];
      const [pmId, editorId] = [
        await getOrCreateRole("password_manager"),
        await getOrCreateRole("editor"),
      ];
      const user = await createUser("GrantElsewhere", [
        { orgId: regionA.id, roleId: pmId },
      ]);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      await client.user.crupdate({
        id: user.id,
        email: user.email,
        roles: [{ orgId: regionB.id, roleName: "editor" }],
      });

      expect(await roleRows(user.id)).toEqual([
        { orgId: regionA.id, roleId: pmId },
        { orgId: regionB.id, roleId: editorId },
      ]);
    });

    it("removes visible roles without requiring admin on a dormant role's org", async () => {
      const [regionA, regionB] = [await createRegion(), await createRegion()];
      const [pmId, editorId] = [
        await getOrCreateRole("password_manager"),
        await getOrCreateRole("editor"),
      ];
      const user = await createUser("RemoveVisible", [
        { orgId: regionA.id, roleId: editorId },
        { orgId: regionB.id, roleId: pmId },
      ]);
      const client = createTestClient();

      // An editor on org A may not remove roles there.
      await mockAuthWithSession(
        createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
      );
      await expect(
        client.user.crupdate({ id: user.id, email: user.email, roles: [] }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: ERRORS.MUST_BE_ADMIN_TO_REMOVE_ROLES,
      });

      // An admin on org A only: the dormant role on org B is not a removal,
      // so admin on B is not required.
      await mockAuthWithSession(
        createRegionAdminSession({ orgId: regionA.id, orgName: regionA.name }),
      );
      await client.user.crupdate({ id: user.id, email: user.email, roles: [] });

      expect(await roleRows(user.id)).toEqual([
        { orgId: regionB.id, roleId: pmId },
      ]);
    });

    it("re-submits an existing role alongside a dormant role on the same org", async () => {
      const nation = await getOrCreateF3NationOrg();
      const region = await createRegion();
      const [pmId, editorId] = [
        await getOrCreateRole("password_manager"),
        await getOrCreateRole("editor"),
      ];
      // Legacy data: two roles on one org, one of them dormant.
      const user = await createUser("LegacyPair", [
        { orgId: region.id, roleId: pmId },
        { orgId: region.id, roleId: editorId },
      ]);
      const before = await roleRows(user.id);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      await client.user.crupdate({
        id: user.id,
        email: user.email,
        roles: [{ orgId: region.id, roleName: "editor" }],
      });

      expect(await roleRows(user.id)).toEqual(before);
    });

    it("rejects granting a role on an org where a hidden role is retained", async () => {
      const nation = await getOrCreateF3NationOrg();
      const pmId = await getOrCreateRole("password_manager");
      const user = await createUser("ConflictMe", [
        { orgId: nation.id, roleId: pmId },
      ]);

      await mockAuthWithSession(nationAdminSession(nation));
      const client = createTestClient();
      // The form hides password_manager, so the admin submits only editor
      // on the same org. Saving it would leave the user with two roles on
      // that org, so it must be rejected rather than silently created.
      await expect(
        client.user.crupdate({
          id: user.id,
          email: user.email,
          roles: [{ orgId: nation.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: ERRORS.ROLE_CONFLICTS_WITH_HIDDEN_ROLE,
      });

      expect(await roleRows(user.id)).toEqual([
        { orgId: nation.id, roleId: pmId },
      ]);
    });
  });
});
