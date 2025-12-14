import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { eq, inArray, schema } from "@acme/db";
import { isTruthy, onlyUnique } from "@acme/shared/common/functions";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";

export interface CheckUpdatePermissionsInput {
  originalEventId?: number | null;
  originalLocationId?: number | null;
  newLocationId?: number | null;
  originalRegionId: number;
  newRegionId?: number | null;
}

export const checkUpdatePermissions = async (params: {
  input: CheckUpdatePermissionsInput;
  ctx: {
    db: AppDb;
    session: Session | null;
  };
}) => {
  const { input, ctx } = params;
  const session = ctx.session;
  if (!session) {
    return {
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    };
  }

  const [existingEvent] = input.originalEventId
    ? await ctx.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, input.originalEventId))
    : [null];

  const locationIds = [
    input.originalLocationId,
    input.newLocationId,
    existingEvent?.locationId,
  ].filter(isTruthy);

  const locations = locationIds.length
    ? await ctx.db
        .select()
        .from(schema.locations)
        .where(inArray(schema.locations.id, locationIds))
    : [];

  const orgsToCheck = [
    existingEvent?.orgId,
    ...locations.map((l) => l?.orgId),
    input.originalRegionId,
    input.newRegionId,
  ]
    .filter(isTruthy)
    .filter(onlyUnique);

  const canEditRegions =
    orgsToCheck.length === 0
      ? [{ success: false, orgId: null, roleName: null, mode: "no-permission" }]
      : await Promise.all(
          orgsToCheck.map(async (orgId) => {
            return await checkHasRoleOnOrg({
              orgId,
              session,
              db: ctx.db,
              roleName: "editor",
            });
          }),
        );

  return {
    success: canEditRegions.every((c) => c.success),
    results: canEditRegions,
  };
};
