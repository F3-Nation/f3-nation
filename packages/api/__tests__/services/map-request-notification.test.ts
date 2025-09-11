import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { InferInsertModel } from "@acme/db";
import { or, schema, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { env } from "@acme/env";

// Import mail service for assertions
import { mail, Templates } from "../../src/mail";
// Import the functions directly to test them in isolation
import {
  getUsersWithRoles,
  notifyMapChangeRequest,
} from "../../src/services/map-request-notification";

// Mock the mail service
vi.mock("../../src/mail", () => ({
  mail: {
    sendTemplateMessages: vi.fn().mockResolvedValue(true),
  },
  Templates: {
    mapChangeRequest: "map-change-request",
  },
}));

// Patch only the NEXT_PUBLIC_URL while keeping other env values intact
const originalNextPublicUrl = env.NEXT_PUBLIC_URL;
vi.spyOn(env, "NEXT_PUBLIC_URL", "get").mockReturnValue(
  "https://test.example.com",
);

// Define the user response type
interface UserResponse {
  userId: number;
  email: string;
  roleName: string;
  orgName: string;
}

// Define test constants
const REGION_ORG_ID = 5000;
const AREA_ORG_ID = 5001;
const SECTOR_ORG_ID = 5002;
const NATION_ORG_ID = 5003;
const TEST_ORPHAN_REGION_ID = 7999;

// Define user IDs
const REGION_ADMIN_ID = 6000;
const REGION_EDITOR_ID = 6001;
const AREA_ADMIN_ID = 6002;
const SECTOR_ADMIN_ID = 6003;
const NATION_ADMIN_ID = 6004;
const NO_ROLES_USER_ID = 6005;

// Define request IDs
const TEST_REQUEST_ID = "123e4567-e89b-12d3-a456-426634334000";

describe("map-request-notification service", () => {
  // Setup test data before running tests
  beforeAll(async () => {
    const mockSendTemplateMessages =
      mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
    mockSendTemplateMessages.mockClear();

    // Temporarily disable foreign key constraints for setup
    await db.execute(sql`SET session_replication_role = 'replica';`);

    try {
      // First delete update requests
      await db
        .delete(schema.updateRequests)
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));

      // Also clean up the orphan request if it exists
      await db
        .delete(schema.updateRequests)
        .where(
          eq(schema.updateRequests.id, "88888888-e89b-12d3-a456-426634334000"),
        );

      // Clean up any existing role assignments
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            inArray(schema.rolesXUsersXOrg.userId, [
              REGION_ADMIN_ID,
              REGION_EDITOR_ID,
              AREA_ADMIN_ID,
              SECTOR_ADMIN_ID,
              NATION_ADMIN_ID,
              NO_ROLES_USER_ID,
            ]),
            inArray(schema.rolesXUsersXOrg.orgId, [
              REGION_ORG_ID,
              AREA_ORG_ID,
              SECTOR_ORG_ID,
              NATION_ORG_ID,
            ]),
          ),
        );

      // Also clean up any other role assignments that might exist
      try {
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, 2000));
      } catch (error) {
        console.log("No records with user_id 2000 to clean up");
      }

      // Now delete the users
      await db
        .delete(schema.users)
        .where(
          or(
            inArray(schema.users.id, [
              REGION_ADMIN_ID,
              REGION_EDITOR_ID,
              AREA_ADMIN_ID,
              SECTOR_ADMIN_ID,
              NATION_ADMIN_ID,
              NO_ROLES_USER_ID,
            ]),
            inArray(schema.users.email, [
              "region-admin@test.com",
              "region-editor@test.com",
              "area-admin@test.com",
              "sector-admin@test.com",
              "nation-admin@test.com",
              "no-roles@test.com",
            ]),
          ),
        );

      // Clean up test orgs (delete in correct order - children first)
      await db.delete(schema.orgs).where(eq(schema.orgs.id, REGION_ORG_ID));
      await db
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, TEST_ORPHAN_REGION_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, AREA_ORG_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, SECTOR_ORG_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, NATION_ORG_ID));

      // Get role IDs
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      const adminRoleId = adminRole.id;
      const editorRoleId = editorRole.id;

      // Create organizations in hierarchy
      await db.insert(schema.orgs).values([
        {
          id: NATION_ORG_ID,
          name: "Test Nation",
          orgType: "nation",
          isActive: true,
        },
        {
          id: SECTOR_ORG_ID,
          name: "Test Sector",
          orgType: "sector",
          isActive: true,
          parentId: NATION_ORG_ID,
        },
        {
          id: AREA_ORG_ID,
          name: "Test Area",
          orgType: "area",
          isActive: true,
          parentId: SECTOR_ORG_ID,
        },
        {
          id: REGION_ORG_ID,
          name: "Test Region",
          orgType: "region",
          isActive: true,
          parentId: AREA_ORG_ID,
        },
      ]);

      // Create test users
      const testUsers: InferInsertModel<typeof schema.users>[] = [
        {
          id: REGION_ADMIN_ID,
          email: "region-admin@test.com",
          f3Name: "Region Admin",
          status: "active",
        },
        {
          id: REGION_EDITOR_ID,
          email: "region-editor@test.com",
          f3Name: "Region Editor",
          status: "active",
        },
        {
          id: AREA_ADMIN_ID,
          email: "area-admin@test.com",
          f3Name: "Area Admin",
          status: "active",
        },
        {
          id: SECTOR_ADMIN_ID,
          email: "sector-admin@test.com",
          f3Name: "Sector Admin",
          status: "active",
        },
        {
          id: NATION_ADMIN_ID,
          email: "nation-admin@test.com",
          f3Name: "Nation Admin",
          status: "active",
        },
        {
          id: NO_ROLES_USER_ID,
          email: "no-roles@test.com",
          f3Name: "No Roles User",
          status: "active",
        },
      ];

      await db
        .insert(schema.users)
        .values(testUsers)
        .onConflictDoUpdate({
          target: [schema.users.id],
          set: {
            email: sql`excluded.email`,
            f3Name: sql`excluded.f3_name`,
            status: sql`excluded.status`,
            id: sql`excluded.id`,
          },
        });

      // Assign roles to users
      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRoleId,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRoleId,
          orgId: REGION_ORG_ID,
        },
        {
          userId: AREA_ADMIN_ID,
          roleId: adminRoleId,
          orgId: AREA_ORG_ID,
        },
        {
          userId: SECTOR_ADMIN_ID,
          roleId: adminRoleId,
          orgId: SECTOR_ORG_ID,
        },
        {
          userId: NATION_ADMIN_ID,
          roleId: adminRoleId,
          orgId: NATION_ORG_ID,
        },
      ]);

      // Create a test update request
      await db.insert(schema.updateRequests).values({
        id: TEST_REQUEST_ID,
        regionId: REGION_ORG_ID,
        eventName: "Test Event",
        submittedBy: "Test User",
        requestType: "create_event",
        status: "pending",
      });
    } finally {
      // Re-enable foreign key constraints
      await db.execute(sql`SET session_replication_role = 'origin';`);
    }
  });

  describe("getUsersWithRoles", () => {
    it("should find admin and editor users for a region", async () => {
      const users = await getUsersWithRoles({
        db,
        orgId: REGION_ORG_ID,
        roleNames: ["admin", "editor"],
      });

      expect(users).toHaveLength(2);
      expect(users.map((u) => u.email).sort()).toEqual(
        ["region-admin@test.com", "region-editor@test.com"].sort(),
      );

      // Verify role and org properties
      const adminUser = users.find((u) => u.email === "region-admin@test.com");
      const editorUser = users.find(
        (u) => u.email === "region-editor@test.com",
      );

      expect(adminUser?.roleName).toBe("admin");
      expect(adminUser?.orgName).toBe("Test Region");
      expect(editorUser?.roleName).toBe("editor");
      expect(editorUser?.orgName).toBe("Test Region");
    });

    it("should find only admin users when filtering by admin role", async () => {
      const users = await getUsersWithRoles({
        db,
        orgId: REGION_ORG_ID,
        roleNames: ["admin"],
      });

      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe("region-admin@test.com");
      expect(users[0]?.roleName).toBe("admin");
      expect(users[0]?.orgName).toBe("Test Region");
    });

    it("should find only editor users when filtering by editor role", async () => {
      const users = await getUsersWithRoles({
        db,
        orgId: REGION_ORG_ID,
        roleNames: ["editor"],
      });

      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe("region-editor@test.com");
      expect(users[0]?.roleName).toBe("editor");
      expect(users[0]?.orgName).toBe("Test Region");
    });

    it("should return empty array for org with no roles", async () => {
      const users = await getUsersWithRoles({
        db,
        orgId: 9999, // Non-existent org ID
        roleNames: ["admin", "editor"],
      });

      expect(users).toHaveLength(0);
    });
  });

  describe("findParentOrgByType (testing through notifyMapChangeRequest)", () => {
    it("should find admins at the area level when no region admins exist", async () => {
      // Remove region admins/editors temporarily
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            eq(schema.rolesXUsersXOrg.userId, REGION_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, REGION_EDITOR_ID),
          ),
        );

      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Call the notification function
      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      // Check that the email was sent to area admin
      expect(mockSendTemplateMessages).toHaveBeenCalledTimes(1);
      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          to: "area-admin@test.com",
          noAdminsNotice: true,
        }),
      );

      // Restore region admins/editors for other tests
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRole.id,
          orgId: REGION_ORG_ID,
        },
      ]);
    });

    it("should find admins at the sector level when no region/area admins exist", async () => {
      // Remove region and area admins/editors temporarily
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            eq(schema.rolesXUsersXOrg.userId, REGION_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, REGION_EDITOR_ID),
            eq(schema.rolesXUsersXOrg.userId, AREA_ADMIN_ID),
          ),
        );

      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Call the notification function
      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      // Check that the email was sent to sector admin
      expect(mockSendTemplateMessages).toHaveBeenCalledTimes(1);
      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          to: "sector-admin@test.com",
          noAdminsNotice: true,
        }),
      );

      // Restore removed admins/editors for other tests
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: AREA_ADMIN_ID,
          roleId: adminRole.id,
          orgId: AREA_ORG_ID,
        },
      ]);
    });

    it("should find admins at the nation level when no region/area/sector admins exist", async () => {
      // Remove region, area, and sector admins temporarily
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            eq(schema.rolesXUsersXOrg.userId, REGION_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, REGION_EDITOR_ID),
            eq(schema.rolesXUsersXOrg.userId, AREA_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, SECTOR_ADMIN_ID),
          ),
        );

      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // NOTE: The bug has been fixed!
      // In notifyMapChangeRequest.ts, we were using sector.id instead of nation.id
      // Now this test verifies the fixed behavior

      // Call the notification function - we now expect proper escalation
      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      // Now the function correctly sends an email to the nation admin
      expect(mockSendTemplateMessages).toHaveBeenCalledTimes(1);
      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          to: "nation-admin@test.com",
          noAdminsNotice: true,
          recipientRole: "admin",
          recipientOrg: "Test Nation",
        }),
      );

      // Restore the roles for other tests
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: AREA_ADMIN_ID,
          roleId: adminRole.id,
          orgId: AREA_ORG_ID,
        },
        {
          userId: SECTOR_ADMIN_ID,
          roleId: adminRole.id,
          orgId: SECTOR_ORG_ID,
        },
      ]);
    });

    // Test for the fixed implementation
    it("should correctly find admins at the nation level with fixed implementation", async () => {
      // Remove region, area, and sector admins temporarily
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            eq(schema.rolesXUsersXOrg.userId, REGION_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, REGION_EDITOR_ID),
            eq(schema.rolesXUsersXOrg.userId, AREA_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, SECTOR_ADMIN_ID),
          ),
        );

      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Call the notification function with the regular region request
      // Since we've removed all the admins/editors at region, area, and sector levels,
      // it should escalate to the nation level with our fixed implementation
      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      // Now the function should correctly send an email to the nation admin
      expect(mockSendTemplateMessages).toHaveBeenCalledTimes(1);
      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          to: "nation-admin@test.com",
          noAdminsNotice: true,
          recipientRole: "admin",
          recipientOrg: "Test Nation",
        }),
      );

      // Restore the roles for other tests
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: AREA_ADMIN_ID,
          roleId: adminRole.id,
          orgId: AREA_ORG_ID,
        },
        {
          userId: SECTOR_ADMIN_ID,
          roleId: adminRole.id,
          orgId: SECTOR_ORG_ID,
        },
      ]);
    });

    it("should throw an error when area is not found", async () => {
      // First create a special test region without a parent (area)
      const TEST_ORPHAN_REGION_ID = 5999;

      // Create orphan region
      await db.insert(schema.orgs).values({
        id: TEST_ORPHAN_REGION_ID,
        name: "Orphan Region",
        orgType: "region",
        isActive: true,
        // No parent ID
      });

      // Create test request for the orphan region
      const TEST_ORPHAN_REQUEST_ID = "99999999-e89b-12d3-a456-426634334000";
      await db.insert(schema.updateRequests).values({
        id: TEST_ORPHAN_REQUEST_ID,
        regionId: TEST_ORPHAN_REGION_ID,
        eventName: "Orphan Event",
        submittedBy: "Test User",
        requestType: "create_event",
        status: "pending",
      });

      // Remove region admins/editors temporarily
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          or(
            eq(schema.rolesXUsersXOrg.userId, REGION_ADMIN_ID),
            eq(schema.rolesXUsersXOrg.userId, REGION_EDITOR_ID),
          ),
        );

      // Expect the function to throw an error
      await expect(
        notifyMapChangeRequest({
          db,
          requestId: TEST_ORPHAN_REQUEST_ID,
        }),
      ).rejects.toThrow("Area not found");

      // Clean up
      await db
        .delete(schema.updateRequests)
        .where(eq(schema.updateRequests.id, TEST_ORPHAN_REQUEST_ID));
      await db
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, TEST_ORPHAN_REGION_ID));

      // Restore roles
      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));

      if (!adminRole || !editorRole) {
        throw new Error("Admin or editor role not found");
      }

      await db.insert(schema.rolesXUsersXOrg).values([
        {
          userId: REGION_ADMIN_ID,
          roleId: adminRole.id,
          orgId: REGION_ORG_ID,
        },
        {
          userId: REGION_EDITOR_ID,
          roleId: editorRole.id,
          orgId: REGION_ORG_ID,
        },
      ]);
    });
  });

  describe("notifyMapChangeRequest", () => {
    it("should send notifications to region admins and editors", async () => {
      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Call the notification function
      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      // Check that emails were sent to both region admin and editor
      expect(mockSendTemplateMessages).toHaveBeenCalledTimes(2);

      // Get all the calls and extract the recipient emails
      const calls = mockSendTemplateMessages.mock.calls;
      const recipients = calls.map((call) => call[1].to);

      expect(recipients.sort()).toEqual(
        ["region-admin@test.com", "region-editor@test.com"].sort(),
      );

      // Find calls for admin and editor
      const adminCall = calls.find(
        (call) => call[1].to === "region-admin@test.com",
      );
      const editorCall = calls.find(
        (call) => call[1].to === "region-editor@test.com",
      );

      // Check admin email content format
      expect(adminCall?.[1]).toEqual(
        expect.objectContaining({
          regionName: "Test Region",
          workoutName: "Test Event",
          requestType: "New Workout",
          submittedBy: "Test User",
          requestsUrl: "https://test.example.com/admin/requests",
          noAdminsNotice: false,
          recipientRole: "admin",
          recipientOrg: "Test Region",
        }),
      );

      // Check editor email content format
      expect(editorCall?.[1]).toEqual(
        expect.objectContaining({
          regionName: "Test Region",
          workoutName: "Test Event",
          requestType: "New Workout",
          submittedBy: "Test User",
          requestsUrl: "https://test.example.com/admin/requests",
          noAdminsNotice: false,
          recipientRole: "editor",
          recipientOrg: "Test Region",
        }),
      );
    });

    it("should format request types correctly", async () => {
      // Test for "edit" request type
      await db
        .update(schema.updateRequests)
        .set({ requestType: "edit" })
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));

      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          requestType: "Edit Request",
        }),
      );

      // Test for "create_location" request type
      await db
        .update(schema.updateRequests)
        .set({ requestType: "create_location" })
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));

      mockSendTemplateMessages.mockClear();

      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          requestType: "Update",
        }),
      );

      // Test for "delete_event" request type
      await db
        .update(schema.updateRequests)
        .set({ requestType: "delete_event" })
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));

      mockSendTemplateMessages.mockClear();

      await notifyMapChangeRequest({
        db,
        requestId: TEST_REQUEST_ID,
      });

      expect(mockSendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          requestType: "Delete Workout",
        }),
      );

      // Reset request type for other tests
      await db
        .update(schema.updateRequests)
        .set({ requestType: "create_event" })
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));
    });

    it("should handle non-existent request IDs gracefully", async () => {
      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Call the notification function with a non-existent request ID but still a valid UUID format
      await notifyMapChangeRequest({
        db,
        requestId: "00000000-0000-0000-0000-000000000000",
      });

      // Verify no emails were sent
      expect(mockSendTemplateMessages).not.toHaveBeenCalled();
    });

    it("should handle email sending errors gracefully", async () => {
      const mockSendTemplateMessages =
        mail.sendTemplateMessages as unknown as ReturnType<typeof vi.fn>;
      mockSendTemplateMessages.mockClear();

      // Mock email sending to fail
      mockSendTemplateMessages.mockRejectedValueOnce(
        new Error("Email sending failed"),
      );

      // We should be able to call the function without it throwing an error
      await expect(
        notifyMapChangeRequest({
          db,
          requestId: TEST_REQUEST_ID,
        }),
      ).resolves.not.toThrow();

      // Verify the function attempted to send an email
      expect(mockSendTemplateMessages).toHaveBeenCalled();
    });
  });

  // Clean up after all tests
  afterAll(async () => {
    // Temporarily disable foreign key constraints for cleanup
    await db.execute(sql`SET session_replication_role = 'replica';`);

    try {
      // Clean up test data
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(
          inArray(schema.rolesXUsersXOrg.userId, [
            REGION_ADMIN_ID,
            REGION_EDITOR_ID,
            AREA_ADMIN_ID,
            SECTOR_ADMIN_ID,
            NATION_ADMIN_ID,
            NO_ROLES_USER_ID,
          ]),
        );

      await db
        .delete(schema.users)
        .where(
          inArray(schema.users.id, [
            REGION_ADMIN_ID,
            REGION_EDITOR_ID,
            AREA_ADMIN_ID,
            SECTOR_ADMIN_ID,
            NATION_ADMIN_ID,
            NO_ROLES_USER_ID,
          ]),
        );

      await db
        .delete(schema.updateRequests)
        .where(eq(schema.updateRequests.id, TEST_REQUEST_ID));

      // Also clean up the orphan request if it exists
      await db
        .delete(schema.updateRequests)
        .where(
          eq(schema.updateRequests.id, "88888888-e89b-12d3-a456-426634334000"),
        );

      // Clean up orgs in reverse order of creation - children first
      await db.delete(schema.orgs).where(eq(schema.orgs.id, REGION_ORG_ID));
      await db
        .delete(schema.orgs)
        .where(eq(schema.orgs.id, TEST_ORPHAN_REGION_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, AREA_ORG_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, SECTOR_ORG_ID));
      await db.delete(schema.orgs).where(eq(schema.orgs.id, NATION_ORG_ID));
    } finally {
      // Re-enable foreign key constraints
      await db.execute(sql`SET session_replication_role = 'origin';`);

      // Restore original env after tests
      vi.spyOn(env, "NEXT_PUBLIC_URL", "get").mockReturnValue(
        originalNextPublicUrl,
      );
    }
  });
});
