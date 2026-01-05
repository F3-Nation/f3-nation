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

import type { Session } from "@acme/auth";
import { and, eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockAuthWithSession } from "../__tests__/test-utils";
import { router } from "../index";

describe("User Router", () => {
  beforeAll(async () => {
    // Note: Database should be reset and seeded before running tests
    // Run: pnpm -C packages/db reset-test-db
    // Or set up test database manually
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
        expect(result.user).not.toBeNull();
        expect(result.user?.id).toBe(testUser.id);
        expect(result.includePii).toBe(false);

        // Should not have PII fields when includePii is false
        expect(result.user).not.toHaveProperty("phone");
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
          id: String(testUser.id) as unknown as number, // Simulate coercion
          includePii: false,
        });

        expect(result.user?.id).toBe(testUser.id);
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
    });
  });
});
