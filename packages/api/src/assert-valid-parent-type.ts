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

  // Temporary rollout gate: #924 must make the trigger and seed recount
  // depth-agnostic before Areas can be placed beneath Territories.
  if (childOrgType === "area" && parentOrg.orgType === "territory") {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Area cannot have a Territory parent until AO counting supports it",
    });
  }

  // An AO's parent must be an adjacent region, not just any higher-ranked
  // type: moveAOLocsToNewRegion and the map's region joins both hard-assume
  // an AO's parent is a region, so a skip-level ao->sector/area/nation parent
  // would silently break location/region attribution downstream.
  if (childOrgType === "ao" && parentOrg.orgType !== "region") {
    throw new ORPCError("BAD_REQUEST", {
      message: `${orgTypeDisplay.ao.label} cannot have a parent of type ${orgTypeDisplay[parentOrg.orgType].label}`,
    });
  }

  if (!isValidOrgTypeParent(parentOrg.orgType, childOrgType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${orgTypeDisplay[childOrgType].label} cannot have a parent of type ${orgTypeDisplay[parentOrg.orgType].label}`,
    });
  }
};
