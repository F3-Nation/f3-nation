/**
 * Tests for notifyMapChangeRequest escalation and error handling.
 *
 * When a region has nobody to notify, the request escalates up the org
 * hierarchy (area → territory → sector → nation). Territory is optional: an
 * area with no territory skips straight to sector. When the walk dead-ends it
 * should surface a typed ORPCError("NOT_FOUND", ...) rather than a raw Error,
 * since oRPC would otherwise mask the latter as an opaque 500 and drop the
 * message.
 */

import { ORPCError } from "@orpc/server";
import { eq, inArray, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { mail, Templates } from "@acme/mail";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "../logger";

const ADMIN_REQUESTS_URL = "https://admin.example.test/requests";

// eslint-disable-next-line @typescript-eslint/unbound-method
const sendTemplateMessages = vi.mocked(mail.sendTemplateMessages);

vi.mock("../lib/admin-url", () => ({
  getAdminRequestsUrl: () => ADMIN_REQUESTS_URL,
}));

vi.mock("../logger", { spy: true });

const mockLogError = vi.mocked(loggerModule.logError);

import { createMixedOrgTree, uniqueId } from "../__tests__/test-utils";
import { ORG_TREE_MAX_DEPTH } from "../org-tree";
import { notifyMapChangeRequest } from "./map-request-notification";

describe("notifyMapChangeRequest", () => {
  const createdOrgIds: number[] = [];
  const createdRequestIds: string[] = [];
  const createdUserIds: number[] = [];

  beforeEach(() => {
    sendTemplateMessages.mockClear();
    mockLogError.mockClear();
  });

  afterAll(async () => {
    for (const requestId of createdRequestIds.reverse()) {
      try {
        await db
          .delete(schema.updateRequests)
          .where(eq(schema.updateRequests.id, requestId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    if (createdUserIds.length > 0) {
      try {
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(inArray(schema.rolesXUsersXOrg.userId, createdUserIds));
        await db
          .delete(schema.users)
          .where(inArray(schema.users.id, createdUserIds));
      } catch {
        // Ignore errors during cleanup
      }
    }
    if (createdOrgIds.length > 0) {
      try {
        // Break parent links first so cyclic fixtures can be deleted.
        await db
          .update(schema.orgs)
          .set({ parentId: null })
          .where(inArray(schema.orgs.id, createdOrgIds));
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  const createOrg = async (params: {
    orgType: (typeof schema.orgs.$inferInsert)["orgType"];
    parentId: number | null;
  }) => {
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Org ${uniqueId()}`,
        orgType: params.orgType,
        parentId: params.parentId,
        isActive: true,
      })
      .returning();
    if (!org) throw new Error("Failed to create test org");
    createdOrgIds.push(org.id);
    return org;
  };

  const createRequest = async (regionId: number) => {
    const [request] = await db
      .insert(schema.updateRequests)
      .values({
        regionId,
        requestType: "create_event",
        eventName: `Notification Test ${uniqueId()}`,
        submittedBy: "submitter@example.com",
        status: "pending",
      })
      .returning();
    if (!request) throw new Error("Failed to create test request");
    createdRequestIds.push(request.id);
    return request;
  };

  const addRole = async (orgId: number, roleName: "admin" | "editor") => {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));
    if (!role) throw new Error(`${roleName} role not found`);
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `notify-${roleName}-${uniqueId()}@example.com`,
        f3Name: `Notify ${roleName}`,
      })
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!user) throw new Error("Failed to create test user");
    createdUserIds.push(user.id);
    await db.insert(schema.rolesXUsersXOrg).values({
      roleId: role.id,
      userId: user.id,
      orgId,
    });
    return user.email;
  };

  const sentTo = () =>
    sendTemplateMessages.mock.calls.flatMap(([, params]) =>
      [params].flat().flatMap((message) => message.to ?? []),
    );

  const expectNotFound = async (requestId: string, message: string) => {
    let thrown: unknown;
    try {
      await notifyMapChangeRequest({ db, requestId });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    expect(thrown).toMatchObject({ code: "NOT_FOUND", message });
  };

  it("emails region admins the absolute admin requests URL", async () => {
    const region = await createOrg({ orgType: "region", parentId: null });
    const request = await createRequest(region.id);
    const adminEmail = await addRole(region.id, "admin");

    await notifyMapChangeRequest({ db, requestId: request.id });

    expect(sendTemplateMessages).toHaveBeenCalledTimes(1);
    expect(sendTemplateMessages).toHaveBeenCalledWith(
      Templates.mapChangeRequest,
      expect.objectContaining({
        to: adminEmail,
        requestsUrl: ADMIN_REQUESTS_URL,
        noAdminsNotice: false,
      }),
    );
  });

  it("returns silently when the request does not exist", async () => {
    await expect(
      notifyMapChangeRequest({
        db,
        requestId: "00000000-0000-0000-0000-000000000000",
      }),
    ).resolves.toBeUndefined();
  });

  it("throws NOT_FOUND 'Area not found' when a parentless region has no admins/editors", async () => {
    const region = await createOrg({ orgType: "region", parentId: null });
    const request = await createRequest(region.id);

    await expectNotFound(
      request.id,
      "Area not found, cannot notify admins/editors",
    );
  });

  it("throws NOT_FOUND 'Area has no parent' when the area is the top of the hierarchy", async () => {
    const area = await createOrg({ orgType: "area", parentId: null });
    const region = await createOrg({ orgType: "region", parentId: area.id });
    const request = await createRequest(region.id);

    await expectNotFound(
      request.id,
      "Area has no parent, cannot notify admins/editors",
    );
  });

  it("throws NOT_FOUND 'Sector has no parent' when no sector exists above the area", async () => {
    const top = await createOrg({ orgType: "region", parentId: null });
    const area = await createOrg({ orgType: "area", parentId: top.id });
    const region = await createOrg({ orgType: "region", parentId: area.id });
    const request = await createRequest(region.id);

    await expectNotFound(
      request.id,
      "Sector has no parent, cannot notify admins/editors",
    );
  });

  it("throws NOT_FOUND 'Nation not found' when no nation exists above the sector", async () => {
    const top = await createOrg({ orgType: "region", parentId: null });
    const sector = await createOrg({ orgType: "sector", parentId: top.id });
    const area = await createOrg({ orgType: "area", parentId: sector.id });
    const region = await createOrg({ orgType: "region", parentId: area.id });
    const request = await createRequest(region.id);

    await expectNotFound(
      request.id,
      "Nation not found, cannot notify admins/editors",
    );
  });

  describe("territory tier", () => {
    it("emails the area admin ahead of the territory admin", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      const areaAdmin = await addRole(tree.territoryBranch.area.id, "admin");
      await addRole(tree.territory.id, "admin");
      const request = await createRequest(tree.territoryBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      expect(sentTo()).toEqual([areaAdmin]);
    });

    it("emails only the territory admin when both a territory and a sector admin exist", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      const territoryAdmin = await addRole(tree.territory.id, "admin");
      await addRole(tree.sector.id, "admin");
      const request = await createRequest(tree.territoryBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      expect(sentTo()).toEqual([territoryAdmin]);
      expect(sendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          noAdminsNotice: true,
          recipientRole: "admin",
          recipientOrg: tree.territory.name,
        }),
      );
    });

    it("escalates to the sector admin when the territory has no admins/editors", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      const sectorAdmin = await addRole(tree.sector.id, "admin");
      const request = await createRequest(tree.territoryBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      expect(sentTo()).toEqual([sectorAdmin]);
      expect(sendTemplateMessages).toHaveBeenCalledWith(
        Templates.mapChangeRequest,
        expect.objectContaining({
          noAdminsNotice: true,
          recipientOrg: tree.sector.name,
        }),
      );
    });

    it("skips to the sector admin when the area has no territory", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      // The territory is a sibling of the direct area, not an ancestor.
      await addRole(tree.territory.id, "admin");
      const sectorAdmin = await addRole(tree.sector.id, "admin");
      const request = await createRequest(tree.directBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      expect(sentTo()).toEqual([sectorAdmin]);
    });

    it("falls back to the nation admin when neither the territory nor the sector has an admin", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      const request = await createRequest(tree.territoryBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      // The seeded test nation has its own admin, so assert on the tier rather
      // than an exact recipient count.
      expect(sentTo()).toContain("admin@test.com");
      for (const [, params] of sendTemplateMessages.mock.calls) {
        expect(params).toMatchObject({
          noAdminsNotice: true,
          recipientOrg: tree.nation.name,
        });
      }
    });

    it("falls back to the nation admin when an area with no territory has no sector admin", async () => {
      const tree = await createMixedOrgTree(createdOrgIds);
      const request = await createRequest(tree.directBranch.region.id);

      await notifyMapChangeRequest({ db, requestId: request.id });

      expect(sentTo()).toContain("admin@test.com");
      for (const [, params] of sendTemplateMessages.mock.calls) {
        expect(params).toMatchObject({ recipientOrg: tree.nation.name });
      }
    });

    it("throws NOT_FOUND 'Sector has no parent' when a territory tops the hierarchy with no sector", async () => {
      const territory = await createOrg({
        orgType: "territory",
        parentId: null,
      });
      const area = await createOrg({ orgType: "area", parentId: territory.id });
      const region = await createOrg({ orgType: "region", parentId: area.id });
      const request = await createRequest(region.id);

      await expectNotFound(
        request.id,
        "Sector has no parent, cannot notify admins/editors",
      );
    });

    it("throws NOT_FOUND 'Nation not found' when no nation exists above a territory-bearing tree", async () => {
      const top = await createOrg({ orgType: "region", parentId: null });
      const sector = await createOrg({ orgType: "sector", parentId: top.id });
      const territory = await createOrg({
        orgType: "territory",
        parentId: sector.id,
      });
      const area = await createOrg({ orgType: "area", parentId: territory.id });
      const region = await createOrg({ orgType: "region", parentId: area.id });
      const request = await createRequest(region.id);

      await expectNotFound(
        request.id,
        "Nation not found, cannot notify admins/editors",
      );
    });
  });

  describe("hierarchy walk bounds", () => {
    // Top-down chain: the area is the root, followed by `regionCount` regions.
    // The request's region sits `regionCount` parent edges below the area.
    const createAreaAbove = async (regionCount: number) => {
      const area = await createOrg({ orgType: "area", parentId: null });
      let parentId = area.id;
      for (let i = 0; i < regionCount; i++) {
        const region = await createOrg({ orgType: "region", parentId });
        parentId = region.id;
      }
      return parentId;
    };

    it("finds an area exactly at the depth limit", async () => {
      const bottomRegionId = await createAreaAbove(ORG_TREE_MAX_DEPTH);
      const request = await createRequest(bottomRegionId);

      await expectNotFound(
        request.id,
        "Area has no parent, cannot notify admins/editors",
      );
      expect(mockLogError).not.toHaveBeenCalled();
    });

    it("stops and logs when the area is beyond the depth limit", async () => {
      const bottomRegionId = await createAreaAbove(ORG_TREE_MAX_DEPTH + 1);
      const request = await createRequest(bottomRegionId);

      await expectNotFound(
        request.id,
        "Area not found, cannot notify admins/editors",
      );
      expect(mockLogError).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalledWith(
        "api.org_tree.depth_limit_reached",
        expect.objectContaining({
          direction: "ancestors",
          maxDepth: ORG_TREE_MAX_DEPTH,
          source: "map_request_notification",
        }),
      );
    });

    it("terminates when the hierarchy contains a cycle", async () => {
      const first = await createOrg({ orgType: "region", parentId: null });
      const second = await createOrg({ orgType: "region", parentId: first.id });
      await db
        .update(schema.orgs)
        .set({ parentId: second.id })
        .where(eq(schema.orgs.id, first.id));
      const request = await createRequest(second.id);

      await expectNotFound(
        request.id,
        "Area not found, cannot notify admins/editors",
      );
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });
});
