/**
 * Resolving a Slack identity to its F3 user: open to any authenticated caller,
 * scoped to the requested workspace, and answering with the user ID alone.
 *
 * Callers are real API keys sent as bearer tokens, so every request goes
 * through `getSession`: a key holding a role reaches the lookup, and a key with
 * no role grants is rejected like a caller with no credential.
 */

import { randomUUID } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { eq, inArray, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
} from "../__tests__/test-utils";
import { router } from "../index";

const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const TEAM_ID = `TRESOLVE${suffix}`;
const OTHER_TEAM_ID = `TOTHER${suffix}`;
const LINKED_SLACK_ID = `ULINKED${suffix}`;
const UNLINKED_SLACK_ID = `UUNLINKED${suffix}`;
const OTHER_TEAM_ONLY_SLACK_ID = `UOTHERONLY${suffix}`;

const keys = { editor: randomUUID(), roleless: randomUUID() };

const clientFor = (token?: string) =>
  createRouterClient(router, {
    context: () => ({
      reqHeaders: new Headers({
        client: "slack-resolve-user-test",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      }),
    }),
  });

describe("slack.resolveUser", () => {
  let f3UserId: number;
  let ownerId: number;
  let orgId: number;
  const slackUserRowIds: number[] = [];
  const keyIds: number[] = [];

  beforeAll(async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `resolve-${suffix}@example.test`, f3Name: "Resolved" })
      .returning({ id: schema.users.id });
    if (!user) throw new Error("Failed to create F3 user");
    f3UserId = user.id;

    const identity = {
      userName: "Slack Member",
      email: `slack-${suffix}@example.test`,
      isAdmin: false,
      isOwner: false,
      isBot: false,
      stravaAccessToken: "strava-secret",
    };
    const rows = await db
      .insert(schema.slackUsers)
      .values([
        {
          ...identity,
          slackId: LINKED_SLACK_ID,
          slackTeamId: TEAM_ID,
          userId: f3UserId,
        },
        {
          ...identity,
          slackId: UNLINKED_SLACK_ID,
          slackTeamId: TEAM_ID,
          userId: null,
        },
        {
          ...identity,
          slackId: OTHER_TEAM_ONLY_SLACK_ID,
          slackTeamId: OTHER_TEAM_ID,
          userId: f3UserId,
        },
      ])
      .returning({ id: schema.slackUsers.id });
    slackUserRowIds.push(...rows.map((r) => r.id));

    await getOrCreateRoles();
    const nation = await getOrCreateF3NationOrg();
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Resolve Region ${suffix}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id });
    if (!org) throw new Error("Failed to create org");
    orgId = org.id;

    const [owner] = await db
      .insert(schema.users)
      .values({ email: `key-owner-${suffix}@example.test`, f3Name: "Owner" })
      .returning({ id: schema.users.id });
    if (!owner) throw new Error("Failed to create key owner");
    ownerId = owner.id;

    const [editorRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "editor"));
    if (!editorRole) throw new Error("Missing editor role");

    for (const name of ["editor", "roleless"] as const) {
      const [key] = await db
        .insert(schema.apiKeys)
        .values({ name: `resolve-${name}`, key: keys[name], ownerId })
        .returning({ id: schema.apiKeys.id });
      if (!key) throw new Error(`Failed to create ${name} key`);
      keyIds.push(key.id);
      if (name === "editor") {
        await db
          .insert(schema.rolesXApiKeysXOrg)
          .values({ apiKeyId: key.id, roleId: editorRole.id, orgId });
      }
    }
  });

  afterAll(async () => {
    await db
      .delete(schema.rolesXApiKeysXOrg)
      .where(inArray(schema.rolesXApiKeysXOrg.apiKeyId, keyIds));
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await db
      .delete(schema.slackUsers)
      .where(inArray(schema.slackUsers.id, slackUserRowIds));
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, [f3UserId, ownerId]));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });
    // No cookie session: callers authenticate only with their bearer token.
    await mockAuthWithSession(null);
  });

  const resolve = (
    slackTeamId: string,
    slackUserId: string,
    token: string | null = keys.editor,
  ) =>
    clientFor(token ?? undefined).slack.resolveUser({
      slackTeamId,
      slackUserId,
    });

  it("returns only the linked F3 user ID, for a key holding a role", async () => {
    await expect(resolve(TEAM_ID, LINKED_SLACK_ID)).resolves.toStrictEqual({
      userId: f3UserId,
    });
  });

  it("returns null for an identity with no F3-user link", async () => {
    await expect(resolve(TEAM_ID, UNLINKED_SLACK_ID)).resolves.toStrictEqual({
      userId: null,
    });
  });

  it("does not match an identity stored only under another workspace", async () => {
    await expect(
      resolve(TEAM_ID, OTHER_TEAM_ONLY_SLACK_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for an unknown member", async () => {
    await expect(resolve(TEAM_ID, `UMISSING${suffix}`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a caller with no credential", async () => {
    await expect(resolve(TEAM_ID, LINKED_SLACK_ID, null)).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
  });

  it("rejects an API key with no role grants", async () => {
    await expect(
      resolve(TEAM_ID, LINKED_SLACK_ID, keys.roleless),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each([
    ["a lowercase team ID", "tabc123", "U123"],
    ["an empty user ID", "T123", ""],
    ["a user ID with punctuation", "T123", "U12%"],
    ["a user ID longer than 64 characters", "T123", "U".repeat(65)],
  ])("rejects %s", async (_name, slackTeamId, slackUserId) => {
    await expect(resolve(slackTeamId, slackUserId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
