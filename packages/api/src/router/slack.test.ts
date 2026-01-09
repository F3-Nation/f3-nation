import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { router } from "../index";
import { uniqueId } from "../__tests__/test-utils";

vi.mock("@acme/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acme/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SUPER_ADMIN_API_KEY: "test-admin-key",
    },
  };
});

describe("Slack Router", () => {
  const teamId = uniqueId();
  let slackSpaceId: number;
  let testOrgId: number;

  const createTestClient = (apiKey?: string) => {
    return createRouterClient(router, {
      context: async () => ({
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
      expect(result).toBeUndefined();
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

  describe("getRegion", () => {
    it("should return the region for a team", async () => {
      const client = createTestClient();
      const result = await client.slack.getRegion({ teamId });
      expect(result).not.toBeNull();
      expect(result?.org.id).toBe(testOrgId);
      expect(result?.space.teamId).toBe(teamId);
    });
  });
});
