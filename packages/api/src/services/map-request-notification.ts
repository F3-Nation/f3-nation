import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@acme/db/client";
import type { OrgType, RegionRole } from "@acme/shared/app/enums";
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

interface Org {
  id: number;
  name: string;
  parentId: number | null;
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
 * Finds the nearest org of the given type at or above `orgId`. The walk is
 * bounded by ORG_TREE_MAX_DEPTH and a visited set, so malformed parent links
 * cannot loop forever.
 */
const findParentOrgByType = async ({
  db,
  orgId,
  type,
}: {
  db: AppDb;
  orgId: number;
  type: OrgType;
}): Promise<Org | null> => {
  const visited = new Set<number>();
  let currentId: number | null = orgId;

  for (let depth = 0; currentId !== null; depth++) {
    // Check for a cycle first so one closing past the depth limit is not
    // reported as a depth overrun.
    if (visited.has(currentId)) return null;
    if (depth > ORG_TREE_MAX_DEPTH) {
      logError("api.org_tree.depth_limit_reached", {
        direction: "ancestors",
        maxDepth: ORG_TREE_MAX_DEPTH,
        rootCount: 1,
        source: "map_request_notification",
      });
      return null;
    }
    visited.add(currentId);

    const [currentOrg] = await db
      .select({
        id: schema.orgs.id,
        type: schema.orgs.orgType,
        name: schema.orgs.name,
        parentId: schema.orgs.parentId,
      })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, currentId));

    if (!currentOrg) return null;
    if (currentOrg.type === type) {
      return {
        id: currentOrg.id,
        name: currentOrg.name,
        parentId: currentOrg.parentId,
      };
    }
    currentId = currentOrg.parentId;
  }

  return null;
};

/**
 * Finds the nearest org of the given type at or above `startOrgId` and loads
 * its admins/editors. `org` is null when no such ancestor exists.
 */
const findTierRecipients = async ({
  db,
  startOrgId,
  type,
}: {
  db: AppDb;
  startOrgId: number;
  type: OrgType;
}) => {
  const org = await findParentOrgByType({ db, orgId: startOrgId, type });
  const recipients = org ? await getUsersWithRoles({ db, orgId: org.id }) : [];
  return { org, recipients };
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
      regionParentId: schema.orgs.parentId,
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

  // Escalate region → area → territory → sector → nation, notifying only the
  // first tier that has admins/editors.
  let recipients = await getUsersWithRoles({ db, orgId: request.regionId });

  let area: Org | null = null;
  let sector: Org | null = null;
  let noAdminsNotice = false;

  // If no recipients at region level, look for area level
  if (recipients.length === 0) {
    noAdminsNotice = true;
    area = await findParentOrgByType({
      db,
      orgId: request.regionId,
      type: "area",
    });

    if (!area) {
      throw new ORPCError("NOT_FOUND", {
        message: "Area not found, cannot notify admins/editors",
      });
    }

    recipients = await getUsersWithRoles({ db, orgId: area.id });
  }

  // If still no recipients, look for territory (optional) then sector level
  if (recipients.length === 0) {
    if (!area?.parentId) {
      throw new ORPCError("NOT_FOUND", {
        message: "Area has no parent, cannot notify admins/editors",
      });
    }

    // Both searches start at the area's parent: an area with no territory
    // still has to reach its sector.
    const territoryTier = await findTierRecipients({
      db,
      startOrgId: area.parentId,
      type: "territory",
    });
    recipients = territoryTier.recipients;

    if (recipients.length === 0) {
      const sectorTier = await findTierRecipients({
        db,
        startOrgId: area.parentId,
        type: "sector",
      });
      sector = sectorTier.org;
      recipients = sectorTier.recipients;
    }
  }

  // If still no recipients, look for nation level
  if (recipients.length === 0) {
    if (!sector?.parentId) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sector has no parent, cannot notify admins/editors",
      });
    }
    const nationTier = await findTierRecipients({
      db,
      startOrgId: sector.parentId,
      type: "nation",
    });

    if (!nationTier.org) {
      throw new ORPCError("NOT_FOUND", {
        message: "Nation not found, cannot notify admins/editors",
      });
    }
    recipients = nationTier.recipients;
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
