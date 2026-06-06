import { eq, or, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { router } from "../index";
import { uniqueId } from "../__tests__/test-utils";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
vi.mock("@acme/env", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    env: {
      ...actual.env,
      SUPER_ADMIN_API_KEY: "test-admin-key",
    },
  };
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */

describe("Slack Router", () => {
  const teamId = uniqueId();
  let slackSpaceId: number;
  let testOrgId: number;

  const createTestClient = (apiKey?: string) => {
    return createRouterClient(router, {
      context: () =>
        Promise.resolve({
          reqHeaders: new Headers({
            [Header.Client]: Client.ORPC,
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          }),
        }),
    });
  };

  beforeAll(async () => {
    // Create a test org
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Org-${teamId}`,
        orgType: "region",
        isActive: true,
      })
      .returning();
    testOrgId = org!.id;

    // Create a test slack space
    const [space] = await db
      .insert(schema.slackSpaces)
      .values({
        teamId,
        workspaceName: "Test Workspace",
        settings: {
          welcome_dm_enable: true,
          welcome_dm_template: "Welcome!",
        },
      })
      .returning();
    slackSpaceId = space!.id;

    // Link them
    await db.insert(schema.orgsXSlackSpaces).values({
      orgId: testOrgId,
      slackSpaceId,
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.orgsXSlackSpaces)
      .where(eq(schema.orgsXSlackSpaces.slackSpaceId, slackSpaceId));
    await db
      .delete(schema.slackSpaces)
      .where(eq(schema.slackSpaces.id, slackSpaceId));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, testOrgId));
  });

  describe("getSpace", () => {
    it("should return space settings for a team", async () => {
      const client = createTestClient();
      const result = await client.slack.getSpace({ teamId });
      expect(result).not.toBeNull();
      expect(result?.teamId).toBe(teamId);
      expect(result?.settings).toHaveProperty(
        "welcome_dm_template",
        "Welcome!",
      );
    });

    it("should return null for non-existent team", async () => {
      const client = createTestClient();
      const result = await client.slack.getSpace({ teamId: "non-existent" });
      expect(result).toBeNull();
    });
  });

  describe("getOrCreateSpace", () => {
    it("should return existing space if it exists", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.getOrCreateSpace({ teamId });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(slackSpaceId);
    });

    it("should create new space if it doesn't exist", async () => {
      const newTeamId = uniqueId();
      const client = createTestClient("test-admin-key");
      const result = await client.slack.getOrCreateSpace({
        teamId: newTeamId,
        workspaceName: "New Space",
      });
      expect(result).not.toBeNull();
      expect(result!.teamId).toBe(newTeamId);
      expect(result!.workspaceName).toBe("New Space");

      // Cleanup
      await db
        .delete(schema.slackSpaces)
        .where(eq(schema.slackSpaces.id, result!.id));
    });

    it("should store botToken when provided", async () => {
      const newTeamId = uniqueId();
      const client = createTestClient("test-admin-key");
      const result = await client.slack.getOrCreateSpace({
        teamId: newTeamId,
        workspaceName: "Token Space",
        botToken: "xoxb-test-token",
      });
      expect(result).not.toBeNull();
      expect(result!.teamId).toBe(newTeamId);
      expect(result!.botToken).toBe("xoxb-test-token");

      // Cleanup
      await db
        .delete(schema.slackSpaces)
        .where(eq(schema.slackSpaces.id, result!.id));
    });

    it("should return a single canonical row under concurrent creates", async () => {
      const newTeamId = uniqueId();
      const client = createTestClient("test-admin-key");

      const [first, second] = await Promise.all([
        client.slack.getOrCreateSpace({
          teamId: newTeamId,
          workspaceName: "Concurrent Space",
        }),
        client.slack.getOrCreateSpace({
          teamId: newTeamId,
          workspaceName: "Concurrent Space",
        }),
      ]);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).toBe(second!.id);

      const rows = await db
        .select({ id: schema.slackSpaces.id })
        .from(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, newTeamId));

      expect(rows).toHaveLength(1);

      await db
        .delete(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, newTeamId));
    });
  });

  describe("updateSpaceSettings", () => {
    it("should require an API key", async () => {
      const client = createTestClient();
      await expect(
        client.slack.updateSpaceSettings({
          teamId,
          settings: { welcome_dm_enable: false },
        }),
      ).rejects.toThrow("Unauthorized");
    });

    it("should update settings with a valid API key", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.updateSpaceSettings({
        teamId,
        settings: {
          welcome_dm_enable: false,
          welcome_dm_template: "Updated Welcome!",
        },
      });

      expect(result.success).toBe(true);

      const updated = await client.slack.getSpace({ teamId });
      expect(updated?.settings).toHaveProperty("welcome_dm_enable", false);
      expect(updated?.settings).toHaveProperty(
        "welcome_dm_template",
        "Updated Welcome!",
      );
    });
  });

  describe("getUserBySlackId", () => {
    const slackId = `U${uniqueId()}`;

    beforeAll(async () => {
      await db.insert(schema.slackUsers).values({
        slackId,
        userName: "testuser",
        email: "test@example.com",
        slackTeamId: teamId,
        isAdmin: false,
        isOwner: false,
        isBot: false,
      });
    });

    afterAll(async () => {
      await db
        .delete(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, slackId));
    });

    it("should find a user by slackId", async () => {
      const client = createTestClient();
      const result = await client.slack.getUserBySlackId({ slackId, teamId });
      expect(result).not.toBeNull();
      expect(result?.slackId).toBe(slackId);
      expect(result?.userName).toBe("testuser");
    });
  });

  describe("getOrCreateUser", () => {
    const existingSlackId = `U${uniqueId()}`;
    const newSlackId = `U${uniqueId()}`;

    beforeAll(async () => {
      await db.insert(schema.slackUsers).values({
        slackId: existingSlackId,
        userName: "existing",
        email: "existing@example.com",
        slackTeamId: teamId,
        isAdmin: false,
        isOwner: false,
        isBot: false,
      });
    });

    afterAll(async () => {
      await db
        .delete(schema.slackUsers)
        .where(
          or(
            eq(schema.slackUsers.slackId, existingSlackId),
            eq(schema.slackUsers.slackId, newSlackId),
          ),
        );
    });

    it("should return existing user if they exist", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.getOrCreateUser({
        slackId: existingSlackId,
        teamId,
        userName: "ignored",
      });
      expect(result).not.toBeNull();
      expect(result!.slackId).toBe(existingSlackId);
      expect(result!.userName).toBe("existing");
    });

    it("should create new user if they don't exist", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.getOrCreateUser({
        slackId: newSlackId,
        teamId,
        userName: "newuser",
        email: "new@example.com",
      });
      expect(result).not.toBeNull();
      expect(result!.slackId).toBe(newSlackId);
      expect(result!.userName).toBe("newuser");
    });
  });

  describe("upsertUser", () => {
    const newSlackId = `U${uniqueId()}`;

    afterAll(async () => {
      await db
        .delete(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, newSlackId));
    });

    it("should create a new slack user", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.upsertUser({
        slackId: newSlackId,
        userName: "newuser",
        email: "new@example.com",
        teamId,
        isAdmin: true,
        isOwner: false,
        isBot: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");

      const user = await client.slack.getUserBySlackId({
        slackId: newSlackId,
        teamId,
      });
      expect(user?.userName).toBe("newuser");
      expect(user?.isAdmin).toBe(true);
    });

    it("should update an existing slack user", async () => {
      const client = createTestClient("test-admin-key");
      const result = await client.slack.upsertUser({
        slackId: newSlackId,
        userName: "updateduser",
        teamId,
        isAdmin: false,
        isOwner: false,
        isBot: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");

      const user = await client.slack.getUserBySlackId({
        slackId: newSlackId,
        teamId,
      });
      expect(user?.userName).toBe("updateduser");
      expect(user?.isAdmin).toBe(false);
    });
  });

  describe("composite slackId and teamId scoping", () => {
    const sharedSlackId = `U${uniqueId()}`;
    const teamA = uniqueId();
    const teamB = uniqueId();

    let orgAId: number;
    let orgBId: number;
    let slackSpaceAId: number;
    let slackSpaceBId: number;
    let userAId: number;
    let userBId: number;

    beforeAll(async () => {
      const [adminRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      if (!adminRole) {
        throw new Error("Admin role not found");
      }

      const [orgA] = await db
        .insert(schema.orgs)
        .values({
          name: `Composite Org A-${teamA}`,
          orgType: "region",
          isActive: true,
        })
        .returning();
      const [orgB] = await db
        .insert(schema.orgs)
        .values({
          name: `Composite Org B-${teamB}`,
          orgType: "region",
          isActive: true,
        })
        .returning();

      orgAId = orgA!.id;
      orgBId = orgB!.id;

      const [spaceA] = await db
        .insert(schema.slackSpaces)
        .values({
          teamId: teamA,
          workspaceName: "Composite Workspace A",
          settings: {
            welcome_dm_enable: true,
            welcome_dm_template: "Hello A",
          },
        })
        .returning();
      const [spaceB] = await db
        .insert(schema.slackSpaces)
        .values({
          teamId: teamB,
          workspaceName: "Composite Workspace B",
          settings: {
            welcome_dm_enable: true,
            welcome_dm_template: "Hello B",
          },
        })
        .returning();

      slackSpaceAId = spaceA!.id;
      slackSpaceBId = spaceB!.id;

      await db.insert(schema.orgsXSlackSpaces).values([
        { orgId: orgAId, slackSpaceId: slackSpaceAId },
        { orgId: orgBId, slackSpaceId: slackSpaceBId },
      ]);

      const [userA] = await db
        .insert(schema.users)
        .values({
          email: `composite-a-${uniqueId()}@example.com`,
          firstName: "Composite",
          lastName: "A",
          f3Name: "Composite A",
        })
        .returning();
      const [userB] = await db
        .insert(schema.users)
        .values({
          email: `composite-b-${uniqueId()}@example.com`,
          firstName: "Composite",
          lastName: "B",
          f3Name: "Composite B",
        })
        .returning();

      userAId = userA!.id;
      userBId = userB!.id;

      await db.insert(schema.slackUsers).values([
        {
          slackId: sharedSlackId,
          userName: "team-a-user",
          email: "team-a@example.com",
          slackTeamId: teamA,
          userId: userAId,
          isAdmin: false,
          isOwner: false,
          isBot: false,
        },
        {
          slackId: sharedSlackId,
          userName: "team-b-user",
          email: "team-b@example.com",
          slackTeamId: teamB,
          userId: userBId,
          isAdmin: false,
          isOwner: false,
          isBot: false,
        },
      ]);

      await db.insert(schema.rolesXUsersXOrg).values({
        userId: userAId,
        orgId: orgAId,
        roleId: adminRole.id,
      });
    });

    afterAll(async () => {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, userAId));
      await db
        .delete(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, sharedSlackId));
      await db
        .delete(schema.orgsXSlackSpaces)
        .where(
          or(
            eq(schema.orgsXSlackSpaces.slackSpaceId, slackSpaceAId),
            eq(schema.orgsXSlackSpaces.slackSpaceId, slackSpaceBId),
          ),
        );
      await db
        .delete(schema.slackSpaces)
        .where(
          or(
            eq(schema.slackSpaces.id, slackSpaceAId),
            eq(schema.slackSpaces.id, slackSpaceBId),
          ),
        );
      await db
        .delete(schema.users)
        .where(or(eq(schema.users.id, userAId), eq(schema.users.id, userBId)));
      await db
        .delete(schema.orgs)
        .where(or(eq(schema.orgs.id, orgAId), eq(schema.orgs.id, orgBId)));
    });

    it("scopes getUserBySlackId to the requested team", async () => {
      const client = createTestClient();

      const teamAUser = await client.slack.getUserBySlackId({
        slackId: sharedSlackId,
        teamId: teamA,
      });
      const teamBUser = await client.slack.getUserBySlackId({
        slackId: sharedSlackId,
        teamId: teamB,
      });

      expect(teamAUser).not.toBeNull();
      expect(teamAUser?.slackTeamId).toBe(teamA);
      expect(teamAUser?.userName).toBe("team-a-user");
      expect(teamAUser?.email).toBe("team-a@example.com");

      expect(teamBUser).not.toBeNull();
      expect(teamBUser?.slackTeamId).toBe(teamB);
      expect(teamBUser?.userName).toBe("team-b-user");
      expect(teamBUser?.email).toBe("team-b@example.com");
    });

    it("scopes getOrCreateUser to the requested team", async () => {
      const client = createTestClient("test-admin-key");

      const result = await client.slack.getOrCreateUser({
        slackId: sharedSlackId,
        teamId: teamB,
        userName: "ignored-user",
        email: "ignored@example.com",
      });

      expect(result).not.toBeNull();
      expect(result?.slackTeamId).toBe(teamB);
      expect(result?.userName).toBe("team-b-user");
      expect(result?.email).toBe("team-b@example.com");
    });

    it("scopes upsertUser to the requested team", async () => {
      const client = createTestClient("test-admin-key");

      const result = await client.slack.upsertUser({
        slackId: sharedSlackId,
        userName: "team-b-updated",
        email: "team-b-updated@example.com",
        teamId: teamB,
        isAdmin: false,
        isOwner: false,
        isBot: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");

      const teamAUser = await client.slack.getUserBySlackId({
        slackId: sharedSlackId,
        teamId: teamA,
      });
      const teamBUser = await client.slack.getUserBySlackId({
        slackId: sharedSlackId,
        teamId: teamB,
      });

      expect(teamAUser?.userName).toBe("team-a-user");
      expect(teamAUser?.email).toBe("team-a@example.com");
      expect(teamBUser?.userName).toBe("team-b-updated");
      expect(teamBUser?.email).toBe("team-b-updated@example.com");
    });

    it("scopes role lookups to the requested team", async () => {
      const client = createTestClient("test-admin-key");

      const teamAHasRole = await client.slack.checkUserRole({
        slackId: sharedSlackId,
        teamId: teamA,
      });
      const teamBHasRole = await client.slack.checkUserRole({
        slackId: sharedSlackId,
        teamId: teamB,
      });

      expect(teamAHasRole.hasRole).toBe(true);
      expect(teamAHasRole.userId).toBe(userAId);
      expect(teamAHasRole.orgId).toBe(orgAId);

      expect(teamBHasRole.hasRole).toBe(false);
      expect(teamBHasRole.userId).toBe(userBId);
      expect(teamBHasRole.orgId).toBe(orgBId);

      const teamARoles = await client.slack.getUserRoles({
        slackId: sharedSlackId,
        teamId: teamA,
      });
      const teamBRoles = await client.slack.getUserRoles({
        slackId: sharedSlackId,
        teamId: teamB,
      });

      expect(teamARoles.userId).toBe(userAId);
      expect(teamARoles.regionOrgId).toBe(orgAId);
      expect(teamARoles.isAdmin).toBe(true);
      expect(teamARoles.isEditor).toBe(true);
      expect(teamARoles.roles).toHaveLength(1);
      expect(teamARoles.roles[0]).toMatchObject({
        orgId: orgAId,
        roleName: "admin",
      });

      expect(teamBRoles.userId).toBe(userBId);
      expect(teamBRoles.regionOrgId).toBe(orgBId);
      expect(teamBRoles.isAdmin).toBe(false);
      expect(teamBRoles.isEditor).toBe(false);
      expect(teamBRoles.roles).toHaveLength(0);
    });
  });
});
