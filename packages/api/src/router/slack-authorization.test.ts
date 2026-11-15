/**
 * Who may send Slack messages through the API: the messages.send permission
 * on the target org, from a role there or on an ancestor.
 */

import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { eq, inArray, schema } from "@acme/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { MockInstance } from "vitest";

import {
  createMixedOrgTree,
  createTestClient,
  db,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

const sessionWithRole = (orgId: number, roleName: UserRole): Session => {
  const roles = [{ orgId, orgName: `org ${orgId}`, roleName }];
  return {
    id: 5151,
    email: "slack-sender@example.com",
    user: {
      id: "5151",
      email: "slack-sender@example.com",
      name: "Slack Sender",
      roles,
    },
    roles,
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
};

describe("Slack message authorization", () => {
  const createdOrgIds: number[] = [];
  let orgs: Awaited<ReturnType<typeof createMixedOrgTree>>;
  let regionId: number;
  let slackSpaceId: number;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeAll(async () => {
    await getOrCreateRoles();
    orgs = await createMixedOrgTree(createdOrgIds);
    regionId = orgs.directBranch.region.id;

    const [space] = await db
      .insert(schema.slackSpaces)
      .values({ teamId: `T-PERM-${uniqueId()}`, botToken: "xoxb-test-token" })
      .returning({ id: schema.slackSpaces.id });
    if (!space) throw new Error("Failed to create Slack space");
    slackSpaceId = space.id;
    await db
      .insert(schema.orgsXSlackSpaces)
      .values({ orgId: regionId, slackSpaceId });
  });

  afterAll(async () => {
    await db
      .delete(schema.orgsXSlackSpaces)
      .where(eq(schema.orgsXSlackSpaces.slackSpaceId, slackSpaceId));
    await db
      .delete(schema.slackSpaces)
      .where(eq(schema.slackSpaces.id, slackSpaceId));
    await db
      .update(schema.orgs)
      .set({ parentId: null })
      .where(inArray(schema.orgs.id, createdOrgIds));
    await db.delete(schema.orgs).where(inArray(schema.orgs.id, createdOrgIds));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, channel: "C1", ts: "1.2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const post = () =>
    createTestClient().slack.postMessage({
      regionOrgId: regionId,
      slackChannelId: "C1",
      text: "PRTEST hello",
    });

  const update = () =>
    createTestClient().slack.updateMessage({
      regionOrgId: regionId,
      slackChannelId: "C1",
      ts: "1700000000.000100",
      text: "PRTEST edited",
    });

  it("lets an admin of the region post and update messages", async () => {
    await mockAuthWithSession(sessionWithRole(regionId, "admin"));

    await expect(post()).resolves.toEqual({
      ok: true,
      action: "posted",
      channel: "C1",
      ts: "1.2",
    });
    await expect(update()).resolves.toEqual({
      ok: true,
      action: "updated",
      channel: "C1",
      ts: "1.2",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("lets an admin of an ancestor org post", async () => {
    await mockAuthWithSession(sessionWithRole(orgs.sector.id, "admin"));
    await expect(post()).resolves.toMatchObject({ action: "posted" });
  });

  it.each(["editor", "user"] as const)(
    "rejects an %s of the region",
    async (roleName) => {
      await mockAuthWithSession(sessionWithRole(regionId, roleName));

      await expect(post()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(update()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects an admin of another org", async () => {
    await mockAuthWithSession(
      sessionWithRole(orgs.unrelatedSector.id, "admin"),
    );

    await expect(post()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "This action needs these permissions on the org: Send messages",
    });
    await expect(update()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "This action needs these permissions on the org: Send messages",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
