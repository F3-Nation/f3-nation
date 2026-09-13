import { ORPCError } from "@orpc/server";

import { eq, schema } from "@acme/db";
import type { OrgType } from "@acme/shared/app/enums";
import {
  isValidOrgTypeParent,
  orgTypeDisplay,
} from "@acme/shared/app/org-hierarchy";

import type { Context } from "./shared";

/**
 * Throws unless `parentId` refers to an org whose type outranks `childOrgType`
 * in the hierarchy (ordinal, not adjacent — see org-hierarchy.ts). Nation has
 * no valid ordinal parent by definition, so assigning any parent to it throws.
 */
export const assertValidParentType = async (
  db: Context["db"],
  parentId: number,
  childOrgType: OrgType,
): Promise<void> => {
  if (childOrgType === "nation") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Nation cannot have a parent organization",
    });
  }

  const [parentOrg] = await db
    .select({ orgType: schema.orgs.orgType })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, parentId));

  if (!parentOrg) {
    throw new ORPCError("NOT_FOUND", { message: "Parent org not found" });
  }

  if (!isValidOrgTypeParent(parentOrg.orgType, childOrgType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${orgTypeDisplay[childOrgType].label} cannot have a parent of type ${orgTypeDisplay[parentOrg.orgType].label}`,
    });
  }
};
