/**
 * Tests for User Router - Grant Access Scenarios
 *
 * These tests cover role assignment and permission scoping for the crupdate endpoint.
 *
 * Run with: pnpm test --filter @acme/api user-grant-access.test.ts
 */

import type { Session } from "@acme/auth";
import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("User Router - Grant Access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  describe("PII access scenarios", () => {
    it("admin can see PII fields when requesting with includePii=true", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create a user with PII fields
      const testEmail = `pii-test-${uniqueId()}@example.com`;
      const testPhone = "555-123-4567";
      const [user] = await db
        .insert(schema.users)
        .values({
          email: testEmail,
          f3Name: "PiiTestUser",
          firstName: "Pii",
          lastName: "Test",
          phone: testPhone,
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Assign a role so admin has access to this user's org
      const [adminRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"))
        .limit(1);

      if (adminRole) {
        await db.insert(schema.rolesXUsersXOrg).values({
          userId: user.id,
          orgId: nationOrg.id,
          roleId: adminRole.id,
        });
      }

      // Admin requests user with includePii=true
      const result = await client.user.byId({
        id: user.id,
        includePii: true,
      });

      expect(result.user).not.toBeNull();
      expect(result.includePii).toBe(true);
      expect(result.user?.email).toBe(testEmail);
      expect(result.user?.phone).toBe(testPhone);

      await cleanup.user(user.id);
    });

    it("editor cannot see PII fields even when requesting includePii=true", async () => {
      const nationOrg = await getOrCreateF3NationOrg();

      // First create user as admin
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);

      const testEmail = `pii-editor-test-${uniqueId()}@example.com`;
      const testPhone = "555-987-6543";
      const [user] = await db
        .insert(schema.users)
        .values({
          email: testEmail,
          f3Name: "PiiEditorTest",
          firstName: "Editor",
          lastName: "Test",
          phone: testPhone,
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Assign user to nation org
      const [editorRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"))
        .limit(1);

      if (editorRole) {
        await db.insert(schema.rolesXUsersXOrg).values({
          userId: user.id,
          orgId: nationOrg.id,
          roleId: editorRole.id,
        });
      }

      // Switch to editor session (editor on nation org, not admin)
      const editorSession = createEditorSession({
        orgId: nationOrg.id,
        orgName: nationOrg.name ?? "F3 Nation",
      });
      await mockAuthWithSession(editorSession);
      const editorClient = createTestClient();

      // Editor requests user with includePii=true - should not get PII
      const result = await editorClient.user.byId({
        id: user.id,
        includePii: true,
      });

      expect(result.user).not.toBeNull();
      expect(result.includePii).toBe(false); // Should be false since editor doesn't have admin access
      expect(result.user).not.toHaveProperty("phone");
      expect(result.user).not.toHaveProperty("email");

      // Cleanup as admin
      await mockAuthWithSession(adminSession);
      await cleanup.user(user.id);
    });

    it("admin can update PII fields for users in their org", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create a user
      const originalEmail = `pii-update-${uniqueId()}@example.com`;
      const [user] = await db
        .insert(schema.users)
        .values({
          email: originalEmail,
          f3Name: "PiiUpdateTest",
          phone: "555-000-0000",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Assign user to nation org so admin has access
      const [editorRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"))
        .limit(1);

      if (editorRole) {
        await db.insert(schema.rolesXUsersXOrg).values({
          userId: user.id,
          orgId: nationOrg.id,
          roleId: editorRole.id,
        });
      }

      // Update PII fields
      const newPhone = "555-999-8888";
      const result = await client.user.crupdate({
        id: user.id,
        phone: newPhone,
        roles: [{ orgId: nationOrg.id, roleName: "editor" }],
      });

      expect(result.phone).toBe(newPhone);
      expect(result.email).toBe(originalEmail);

      await cleanup.user(user.id);
    });

    it("byOrgs returns PII only for admin users", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create a user with PII
      const testEmail = `pii-byorgs-${uniqueId()}@example.com`;
      const testPhone = "555-111-2222";
      const [user] = await db
        .insert(schema.users)
        .values({
          email: testEmail,
          f3Name: "PiiByOrgsTest",
          phone: testPhone,
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Assign user to nation org
      const [editorRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"))
        .limit(1);

      if (editorRole) {
        await db.insert(schema.rolesXUsersXOrg).values({
          userId: user.id,
          orgId: nationOrg.id,
          roleId: editorRole.id,
        });
      }

      // Admin requests users by org with includePii=true
      const result = await client.user.byOrgs({
        orgIds: [nationOrg.id],
        includePii: true,
        pageIndex: 0,
        pageSize: 100,
      });

      expect(result.users.length).toBeGreaterThan(0);
      // Find our test user
      const testUser = result.users.find((u) => u.id === user.id);
      expect(testUser).toBeDefined();
      expect(testUser?.phone).toBe(testPhone);

      await cleanup.user(user.id);
    });

    it("byEmail includes email when searching by email", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create a user
      const testEmail = `pii-byemail-${uniqueId()}@example.com`;
      const [user] = await db
        .insert(schema.users)
        .values({
          email: testEmail,
          f3Name: "PiiByEmailTest",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Search by email - should always include email in response
      const result = await client.user.byEmail({
        email: testEmail,
        includePii: false,
      });

      expect(result.user).not.toBeNull();
      expect(result.user?.email).toBe(testEmail);

      await cleanup.user(user.id);
    });
  });

  describe("crupdate - grant access scenarios", () => {
    it("should grant editor role to existing user", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create user without roles
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `grant-test-${uniqueId()}@example.com`,
          f3Name: "GrantTest",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Grant editor role
      const result = await client.user.crupdate({
        id: user.id,
        roles: [{ orgId: nationOrg.id, roleName: "editor" }],
      });

      expect(result.roles).toContainEqual(
        expect.objectContaining({ roleName: "editor" }),
      );

      await cleanup.user(user.id);
    });

    it("should prevent non-admin from granting roles", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      // Editor on a different org (not nation) - should not be able to grant roles
      const editorSession = createEditorSession({
        orgId: nationOrg.id + 999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(editorSession);
      const client = createTestClient();

      // adminProcedure requires admin role, so editor will be rejected
      await expect(
        client.user.crupdate({
          email: `new-${uniqueId()}@example.com`,
          f3Name: "Test",
          roles: [{ orgId: nationOrg.id, roleName: "editor" }],
        }),
      ).rejects.toThrow();
    });

    it("should allow admin to remove roles they have permission for", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const client = createTestClient();

      // Create user with a role
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `remove-role-${uniqueId()}@example.com`,
          f3Name: "RemoveRoleTest",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // First grant a role
      await client.user.crupdate({
        id: user.id,
        roles: [{ orgId: nationOrg.id, roleName: "editor" }],
      });

      // Now remove the role by passing empty roles array
      const result = await client.user.crupdate({
        id: user.id,
        roles: [],
      });

      expect(result.roles).toHaveLength(0);

      await cleanup.user(user.id);
    });

    it("should prevent editor from granting roles to other orgs", async () => {
      const nationOrg = await getOrCreateF3NationOrg();

      // First, create a user as admin
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);
      const _adminClient = createTestClient();

      // Create user with editor role on nation org
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `grant-role-${uniqueId()}@example.com`,
          f3Name: "GrantRoleTest",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Now switch to editor session (editor on nation org, not admin)
      const editorSession = createEditorSession({
        orgId: nationOrg.id,
        orgName: nationOrg.name ?? "F3 Nation",
      });
      await mockAuthWithSession(editorSession);
      const editorClient = createTestClient();

      // Editor tries to grant role - should fail because adminProcedure requires admin role
      await expect(
        editorClient.user.crupdate({
          id: user.id,
          roles: [{ orgId: nationOrg.id, roleName: "editor" }],
        }),
      ).rejects.toThrow("Unauthorized");

      // Cleanup as admin
      await mockAuthWithSession(adminSession);
      await cleanup.user(user.id);
    });

    it("editor updating user yields unauthorized unless role already present", async () => {
      const nationOrg = await getOrCreateF3NationOrg();

      // Create user as admin first
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);
      const adminClient = createTestClient();

      // Create a user with existing editor role on nation org
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `editor-update-${uniqueId()}@example.com`,
          f3Name: "EditorUpdateTest",
        })
        .returning();

      if (!user) {
        throw new Error("Failed to create test user");
      }

      // Grant editor role via admin
      await adminClient.user.crupdate({
        id: user.id,
        roles: [{ orgId: nationOrg.id, roleName: "editor" }],
      });

      // Switch to editor session
      const editorSession = createEditorSession({
        orgId: nationOrg.id,
        orgName: nationOrg.name ?? "F3 Nation",
      });
      await mockAuthWithSession(editorSession);
      const editorClient = createTestClient();

      // Editor tries to update the same user with the same role - should fail
      // because crupdate requires adminProcedure
      await expect(
        editorClient.user.crupdate({
          id: user.id,
          roles: [{ orgId: nationOrg.id, roleName: "editor" }],
        }),
      ).rejects.toThrow("Unauthorized");

      // Editor tries to add a new role - should also fail
      await expect(
        editorClient.user.crupdate({
          id: user.id,
          roles: [
            { orgId: nationOrg.id, roleName: "editor" },
            { orgId: nationOrg.id, roleName: "admin" },
          ],
        }),
      ).rejects.toThrow("Unauthorized");

      // Editor tries to update a different user's access - should fail
      const [anotherUser] = await db
        .insert(schema.users)
        .values({
          email: `another-user-${uniqueId()}@example.com`,
          f3Name: "AnotherUser",
        })
        .returning();

      if (anotherUser) {
        await expect(
          editorClient.user.crupdate({
            id: anotherUser.id,
            roles: [{ orgId: nationOrg.id, roleName: "editor" }],
          }),
        ).rejects.toThrow("Unauthorized");

        // Cleanup another user as admin
        await mockAuthWithSession(adminSession);
        await cleanup.user(anotherUser.id);
      }

      // Cleanup as admin
      await mockAuthWithSession(adminSession);
      await cleanup.user(user.id);
    });
  });

  describe("crupdate - multi-org role scope scenarios", () => {
    // Helper to create an admin session for a specific org
    const createAdminSessionForOrg = (params: {
      orgId: number;
      orgName: string;
    }): Session => {
      return {
        id: 1,
        email: "org-admin@example.com",
        user: {
          id: "1",
          email: "org-admin@example.com",
          name: "Org Admin",
          roles: [
            { orgId: params.orgId, orgName: params.orgName, roleName: "admin" },
          ],
        },
        roles: [
          { orgId: params.orgId, orgName: params.orgName, roleName: "admin" },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    };

    // Helper to create test orgs
    const createTestOrg = async (name: string, orgType = "region") => {
      const [org] = await db
        .insert(schema.orgs)
        .values({
          name,
          orgType: orgType as "region" | "area" | "sector" | "nation" | "ao",
          isActive: true,
        })
        .returning();
      if (!org) throw new Error(`Failed to create test org: ${name}`);
      return org;
    };

    it("admin can grant roles only to orgs they administer", async () => {
      // Create two separate regions
      const regionA = await createTestOrg(`Region A ${uniqueId()}`);
      const regionB = await createTestOrg(`Region B ${uniqueId()}`);

      // Create admin session for Region A only
      const adminSessionA = createAdminSessionForOrg({
        orgId: regionA.id,
        orgName: regionA.name ?? "Region A",
      });
      await mockAuthWithSession(adminSessionA);
      const client = createTestClient();

      // Create a user
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `multi-org-test-${uniqueId()}@example.com`,
          f3Name: "MultiOrgTest",
        })
        .returning();

      if (!user) throw new Error("Failed to create test user");

      // Admin A can grant role on Region A
      const result = await client.user.crupdate({
        id: user.id,
        roles: [{ orgId: regionA.id, roleName: "editor" }],
      });

      expect(result.roles).toContainEqual(
        expect.objectContaining({
          orgId: regionA.id,
          roleName: "editor",
        }),
      );

      // Cleanup
      await cleanup.user(user.id);
      await cleanup.org(regionA.id);
      await cleanup.org(regionB.id);
    });

    it("admin cannot grant roles to orgs outside their scope", async () => {
      // Create two separate regions
      const regionA = await createTestOrg(`Region A ${uniqueId()}`);
      const regionB = await createTestOrg(`Region B ${uniqueId()}`);

      // Create admin session for Region A only
      const adminSessionA = createAdminSessionForOrg({
        orgId: regionA.id,
        orgName: regionA.name ?? "Region A",
      });
      await mockAuthWithSession(adminSessionA);
      const client = createTestClient();

      // Create a user
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `scope-test-${uniqueId()}@example.com`,
          f3Name: "ScopeTest",
        })
        .returning();

      if (!user) throw new Error("Failed to create test user");

      // Admin A tries to grant role on Region B - should fail
      await expect(
        client.user.crupdate({
          id: user.id,
          roles: [{ orgId: regionB.id, roleName: "editor" }],
        }),
      ).rejects.toThrow("You do not have permission to give this role");

      // Cleanup
      await cleanup.user(user.id);
      await cleanup.org(regionA.id);
      await cleanup.org(regionB.id);
    });
  });
});

