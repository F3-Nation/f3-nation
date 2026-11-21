/**
 * Resolving a Slack identity to its F3 user: open to any authenticated caller,
 * scoped to the requested workspace, and answering with the user ID alone.
 */

import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import { eq, inArray, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestClient,
  db,
  mockAuthWithSession,
} from "../__tests__/test-utils";

const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const TEAM_ID = `TRESOLVE${suffix}`;
const OTHER_TEAM_ID = `TOTHER${suffix}`;
const LINKED_SLACK_ID = `ULINKED${suffix}`;
const UNLINKED_SLACK_ID = `UUNLINKED${suffix}`;
const OTHER_TEAM_ONLY_SLACK_ID = `UOTHERONLY${suffix}`;

/** An API key with no role grants: the narrowest credential the tier admits. */
const rolelessApiKeySession = (): Session =>
  ({
    apiKey: { id: 1 },
    id: 7171,
    user: { id: "7171", name: "Roleless key", roles: [] },
    roles: [],
    expires: new Date(Date.now() + 60_000).toISOString(),
  }) as unknown as Session;

describe("slack.resolveUser", () => {
  let f3UserId: number;
  const slackUserRowIds: number[] = [];

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
  });

  afterAll(async () => {
    await db
      .delete(schema.slackUsers)
      .where(inArray(schema.slackUsers.id, slackUserRowIds));
    await db.delete(schema.users).where(eq(schema.users.id, f3UserId));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });
    await mockAuthWithSession(rolelessApiKeySession());
  });

  const resolve = (slackTeamId: string, slackUserId: string) =>
    createTestClient().slack.resolveUser({ slackTeamId, slackUserId });

  it("returns only the linked F3 user ID, for a key with no roles", async () => {
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

  it("rejects a caller with no session", async () => {
    await mockAuthWithSession(null);
    await expect(resolve(TEAM_ID, LINKED_SLACK_ID)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it.each([
    ["a lowercase team ID", "tabc123", "U123"],
    ["an empty user ID", "T123", ""],
    ["a user ID with punctuation", "T123", "U12%"],
  ])("rejects %s", async (_name, slackTeamId, slackUserId) => {
    await expect(resolve(slackTeamId, slackUserId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
