import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { aliasedTable, eq, schema } from "@acme/db";
import {
  isProductionNodeEnv,
  isTestNodeEnv,
} from "@acme/shared/common/constants";

import type { Context } from "./shared";

const ALLOW_MTNDEV_OVERRIDE = false as boolean;

const LOG = false as boolean;

export const checkHasRoleOnOrg = async ({
  session,
  orgId,
  db,
  roleName,
}: {
  session: Session | null;
  roleName: UserRole;
  orgId: number;
  db: Context["db"];
}): Promise<{
  success: boolean;
  orgId: number | null;
  roleName: UserRole | null;
  mode: "mtndev-override" | "direct-permission" | "org-admin" | "no-permission";
}> => {
  if (!session) {
    return {
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    };
  }

  if (LOG)
    console.log(
      "Checking if user has role on org",
      session.id,
      orgId,
      roleName,
      "roles",
      session.roles,
    );

  // F3 Nation
  if (
    session.email === "declan@mountaindev.com" ||
    (!isProductionNodeEnv && !isTestNodeEnv && ALLOW_MTNDEV_OVERRIDE)
  ) {
    const nations = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.orgType, "nation"));
    console.log("OVERRIDING ROLE DUE TO MTNDEV OVERRIDE (OR DEV)");
    if (nations.find((n) => n.id === orgId)) {
      return {
        success: true,
        orgId,
        roleName,
        mode: "mtndev-override",
      };
    }
  }

  const hasDirectAccessForThisOrg = session.roles?.some(
    (r) =>
      (r.roleName === "admin" || r.roleName === roleName) && r.orgId === orgId,
  );
  if (hasDirectAccessForThisOrg)
    return {
      success: true,
      orgId: orgId,
      roleName: roleName,
      mode: "direct-permission",
    };

  // Next, see if the user has a role for an org that is a parent or ancestor of the org in question
  // Assume the org is an AO and trace up the hierarchy
  const level1Org = aliasedTable(schema.orgs, "level_1_org"); // AO
  const level2Org = aliasedTable(schema.orgs, "level_2_org"); // Region
  const level3Org = aliasedTable(schema.orgs, "level_3_org"); // Sector
  const level4Org = aliasedTable(schema.orgs, "level_4_org"); // Area
  const level5Org = aliasedTable(schema.orgs, "level_5_org"); // Nation

  const allParentOrgIds = await db
    .select({
      level1Id: level1Org.id,
      level2Id: level2Org.id,
      level3Id: level3Org.id,
      level4Id: level4Org.id,
      level5Id: level5Org.id,
    })
    .from(level1Org)
    .leftJoin(level2Org, eq(level1Org.parentId, level2Org.id))
    .leftJoin(level3Org, eq(level2Org.parentId, level3Org.id))
    .leftJoin(level4Org, eq(level3Org.parentId, level4Org.id))
    .leftJoin(level5Org, eq(level4Org.parentId, level5Org.id))
    .where(eq(level1Org.id, orgId));

  const allAncestorOrgIds = allParentOrgIds.flatMap((o) => [
    o.level1Id,
    o.level2Id,
    o.level3Id,
    o.level4Id,
    o.level5Id,
  ]) as number[];

  const matchingPermission = session.roles?.find(
    (r) =>
      (r.roleName === "admin" || r.roleName === roleName) &&
      allAncestorOrgIds.includes(r.orgId),
  );

  if (matchingPermission) {
    return {
      success: true,
      orgId: matchingPermission.orgId,
      roleName: matchingPermission.roleName,
      mode: "org-admin",
    };
  }

  return { success: false, orgId, roleName, mode: "no-permission" };
};
