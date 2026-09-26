import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@acme/db/client";
import type { RegionRole } from "@acme/shared/app/enums";
import { schema } from "@acme/db";
import { requestTypeToTitle } from "@acme/shared/app/functions";

import { mail, Templates } from "@acme/mail";

import { getAdminRequestsUrl } from "../lib/admin-url";
import { logError, logDebug, logInfo } from "../logger";
import { ORG_TREE_MAX_DEPTH } from "../org-tree";

/**
 * Interface for the notification parameters
 */
interface NotifyMapChangeRequestParams {
  db: AppDb;
  requestId: string;
}

/**
 * Gets admin and editor users for a specific org
 */
export const getUsersWithRoles = async ({
  db,
  orgId,
  roleNames = ["admin", "editor"],
}: {
  db: AppDb;
  orgId: number;
  roleNames?: RegionRole[];
}) => {
  const roleIds = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(inArray(schema.roles.name, roleNames));

  if (!roleIds.length) {
    return [];
  }

  const userRoles = await db
    .select({
      userId: schema.rolesXUsersXOrg.userId,
      email: schema.users.email,
      roleName: schema.roles.name,
      orgName: schema.orgs.name,
    })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.users, eq(schema.users.id, schema.rolesXUsersXOrg.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .where(
      and(
        eq(schema.users.status, "active"),
        eq(schema.rolesXUsersXOrg.orgId, orgId),
        inArray(
          schema.rolesXUsersXOrg.roleId,
          roleIds.map((r) => r.id),
        ),
      ),
    );

  return userRoles;
};

/**
 * Finds admins/editors for `regionId` or, if it has none, the nearest
 * ancestor that does — walking up the org hierarchy one org at a time
 * regardless of org type. Bounded by ORG_TREE_MAX_DEPTH and a visited set,
 * so malformed parent links (including cycles) cannot loop forever.
 * `escalated` is true whenever the recipients came from an ancestor rather
 * than `regionId` itself.
 */
const findNearestRecipients = async ({
  db,
  regionId,
}: {
  db: AppDb;
  regionId: number;
}): Promise<{
  recipients: Awaited<ReturnType<typeof getUsersWithRoles>>;
  escalated: boolean;
}> => {
  const visited = new Set<number>();
  let currentId: number | null = regionId;

  for (let depth = 0; currentId !== null; depth++) {
    // Check for a cycle first so one closing past the depth limit is not
    // reported as a depth overrun.
    if (visited.has(currentId)) return { recipients: [], escalated: true };
    if (depth > ORG_TREE_MAX_DEPTH) {
      logError("api.org_tree.depth_limit_reached", {
        direction: "ancestors",
        maxDepth: ORG_TREE_MAX_DEPTH,
        rootCount: 1,
        source: "map_request_notification",
      });
      return { recipients: [], escalated: true };
    }
    visited.add(currentId);

    const recipients = await getUsersWithRoles({ db, orgId: currentId });
    if (recipients.length > 0) {
      return { recipients, escalated: currentId !== regionId };
    }

    const [currentOrg] = await db
      .select({ parentId: schema.orgs.parentId })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, currentId));

    if (!currentOrg) return { recipients: [], escalated: true };
    currentId = currentOrg.parentId;
  }

  return { recipients: [], escalated: true };
};

/**
 * Notifies admins and editors about a new map change request
 */
export const notifyMapChangeRequest = async ({
  db,
  requestId,
}: NotifyMapChangeRequestParams): Promise<void> => {
  logDebug("api.map_request_notification.start", { requestId });

  // Get request details
  const [request] = await db
    .select({
      id: schema.updateRequests.id,
      regionId: schema.updateRequests.regionId,
      regionName: schema.orgs.name,
      eventName: schema.updateRequests.eventName,
      submittedBy: schema.updateRequests.submittedBy,
      requestType: schema.updateRequests.requestType,
    })
    .from(schema.updateRequests)
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.updateRequests.regionId))
    .where(eq(schema.updateRequests.id, requestId));

  if (!request) {
    logInfo("api.map_request_notification.request_not_found", { requestId });
    return;
  }

  // Escalate up the org hierarchy, one org at a time, notifying the first
  // one — regardless of its org type — that has admins/editors.
  const { recipients, escalated: noAdminsNotice } = await findNearestRecipients(
    { db, regionId: request.regionId },
  );

  if (recipients.length === 0) {
    throw new ORPCError("NOT_FOUND", {
      message: "No admins/editors found at any level, cannot notify",
    });
  }

  // Prepare email parameters
  const requestsUrl = getAdminRequestsUrl();
  const title = requestTypeToTitle(request.requestType);

  // Send emails
  const emailPromises = recipients.map(async (recipient) => {
    try {
      await mail.sendTemplateMessages(Templates.mapChangeRequest, {
        to: recipient.email,
        regionName: request.regionName ?? "Unknown",
        workoutName: request.eventName ?? "Unknown",
        requestType: title,
        submittedBy: request.submittedBy,
        requestsUrl,
        noAdminsNotice,
        recipientRole: recipient.roleName,
        recipientOrg: recipient.orgName ?? "Unknown",
      });

      logInfo("api.map_request_notification.email_sent", {
        recipientUserId: recipient.userId,
        requestId,
      });
    } catch (error) {
      logError(
        "api.map_request_notification.email_failed",
        { recipientUserId: recipient.userId, requestId },
        error,
      );
    }
  });

  await Promise.all(emailPromises);
};
