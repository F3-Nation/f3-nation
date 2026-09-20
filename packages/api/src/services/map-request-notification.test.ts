/**
 * Tests for notifyMapChangeRequest error handling.
 *
 * When a region (and its area/sector/nation ancestors) has nobody to notify,
 * the walk up the org hierarchy should surface a typed
 * ORPCError("NOT_FOUND", ...) rather than a raw Error, since oRPC would
 * otherwise mask the latter as an opaque 500 and drop the message.
 */

import { ORPCError } from "@orpc/server";
import { eq, inArray, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { mail, Templates } from "@acme/mail";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN_REQUESTS_URL = "https://admin.example.test/requests";

// eslint-disable-next-line @typescript-eslint/unbound-method
const sendTemplateMessages = vi.mocked(mail.sendTemplateMessages);

vi.mock("../lib/admin-url", () => ({
  getAdminRequestsUrl: () => ADMIN_REQUESTS_URL,
}));

import { uniqueId } from "../__tests__/test-utils";
import { notifyMapChangeRequest } from "./map-request-notification";

describe("notifyMapChangeRequest", () => {
  const createdOrgIds: number[] = [];
  const createdRequestIds: string[] = [];
  const createdUserIds: number[] = [];

  beforeEach(() => {
    sendTemplateMessages.mockClear();
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

    const [adminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "admin"));
    if (!adminRole) throw new Error("Admin role not found");
    const [admin] = await db
      .insert(schema.users)
      .values({
        email: `notify-admin-${uniqueId()}@example.com`,
        f3Name: "Notify Admin",
      })
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!admin) throw new Error("Failed to create test admin");
    createdUserIds.push(admin.id);
    await db.insert(schema.rolesXUsersXOrg).values({
      roleId: adminRole.id,
      userId: admin.id,
      orgId: region.id,
    });

    await notifyMapChangeRequest({ db, requestId: request.id });

    expect(sendTemplateMessages).toHaveBeenCalledTimes(1);
    expect(sendTemplateMessages).toHaveBeenCalledWith(
      Templates.mapChangeRequest,
      expect.objectContaining({
        to: admin.email,
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
});
