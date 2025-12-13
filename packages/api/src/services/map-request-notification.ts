import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@acme/db/client";
import type { OrgType, RegionRole } from "@acme/shared/app/enums";
import { schema } from "@acme/db";
import { env } from "@acme/env";
import { requestTypeToTitle } from "@acme/shared/app/functions";

import { mail, Templates } from "../mail";

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
 * Finds the parent org with the given type
 */
const findParentOrgByType = async ({
  db,
  orgId,
  type,
}: {
  db: AppDb;
  orgId: number;
  type: OrgType;
}): Promise<{ id: number; name: string; parentId: number | null } | null> => {
  // First check if current org is of the required type
  const [currentOrg] = await db
    .select({
      id: schema.orgs.id,
      type: schema.orgs.orgType,
      name: schema.orgs.name,
      parentId: schema.orgs.parentId,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));

  if (!currentOrg) return null;
  if (currentOrg.type === type)
    return {
      id: currentOrg.id,
      name: currentOrg.name,
      parentId: currentOrg.parentId,
    };

  if (!currentOrg.parentId) return null;

  return findParentOrgByType({ db, orgId: currentOrg.parentId, type });
};

/**
 * Notifies admins and editors about a new map change request
 */
export const notifyMapChangeRequest = async ({
  db,
  requestId,
}: NotifyMapChangeRequestParams): Promise<void> => {
  console.log("notifyMapChangeRequest", { requestId });

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
    console.log("notifyMapChangeRequest: Request not found", { requestId });
    return;
  }

  // Try to find region admins/editors
  let recipients = await getUsersWithRoles({
    db,
    orgId: request.regionId,
    roleNames: ["admin", "editor"],
  });

  let area: Org | null = null;
  let sector: Org | null = null;
  let nation: Org | null = null;
  let noAdminsNotice = false;

  // If no recipients at region level, look for area level
  if (recipients.length === 0) {
    area = await findParentOrgByType({
      db,
      orgId: request.regionId,
      type: "area",
    });

    if (!area) {
      throw new Error("Area not found, cannot notify admins/editors");
    }

    const areaRecipients = await getUsersWithRoles({
      db,
      orgId: area.id,
      roleNames: ["admin", "editor"],
    });

    recipients = areaRecipients;
    noAdminsNotice = true;
  }

  // If still no recipients, look for sector level
  if (recipients.length === 0) {
    if (!area?.parentId) {
      throw new Error("Area has no parent, cannot notify admins/editors");
    }
    sector = await findParentOrgByType({
      db,
      orgId: area?.parentId,
      type: "sector",
    });

    if (sector) {
      const sectorRecipients = await getUsersWithRoles({
        db,
        orgId: sector.id,
        roleNames: ["admin", "editor"],
      });

      recipients = sectorRecipients;
      noAdminsNotice = true;
    }
  }

  // If still no recipients, look for nation level
  if (recipients.length === 0) {
    if (!sector?.parentId) {
      throw new Error("Sector has no parent, cannot notify admins/editors");
    }
    nation = await findParentOrgByType({
      db,
      orgId: sector?.parentId,
      type: "nation",
    });

    if (nation) {
      const nationRecipients = await getUsersWithRoles({
        db,
        orgId: nation.id,
        roleNames: ["admin", "editor"],
      });

      recipients = nationRecipients;
      noAdminsNotice = true;
    } else {
      throw new Error("Nation not found, cannot notify admins/editors");
    }
  }

  // Prepare email parameters
  const baseUrl = env.NEXT_PUBLIC_API_URL?.endsWith("/")
    ? env.NEXT_PUBLIC_API_URL.slice(0, -1)
    : env.NEXT_PUBLIC_API_URL ?? "";

  const requestsUrl = `${baseUrl}/admin/requests`;
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

      console.log("notifyMapChangeRequest: Email sent", {
        recipient: recipient.email,
        requestId,
      });
    } catch (error) {
      console.error("notifyMapChangeRequest: Error sending email", {
        error,
        recipient: recipient.email,
        requestId,
      });
    }
  });

  await Promise.all(emailPromises);
};
