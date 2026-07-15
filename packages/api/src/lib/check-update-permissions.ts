import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { eq, inArray, schema } from "@acme/db";
import { isTruthy, onlyUnique } from "@acme/shared/common/functions";
import type { UpdateRequestOrgIdFields } from "@acme/validators/request-schemas";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";

export type CheckUpdatePermissionsInput = UpdateRequestOrgIdFields;

type RoleCheckResult = Awaited<ReturnType<typeof checkHasRoleOnOrg>>;

export interface UpdatePermissionsResult {
  /** True only if the caller has the editor role on every affected org. */
  success: boolean;
  /** Per-org role checks; empty when there was no session or nothing to check. */
  results: RoleCheckResult[];
}

export const checkUpdatePermissions = async (params: {
  input: CheckUpdatePermissionsInput;
  ctx: {
    db: AppDb;
    session: Session | null;
  };
}): Promise<UpdatePermissionsResult> => {
  const { input, ctx } = params;
  const session = ctx.session;
  if (!session) {
    return { success: false, results: [] };
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
    input.originalAoId,
    input.newAoId,
    input.originalRegionId,
    input.newRegionId,
  ]
    .filter(isTruthy)
    .filter(onlyUnique);

  if (orgsToCheck.length === 0) {
    return { success: false, results: [] };
  }

  const canEditRegions = await Promise.all(
    orgsToCheck.map((orgId) =>
      checkHasRoleOnOrg({
        orgId,
        session,
        db: ctx.db,
        roleName: "editor",
      }),
    ),
  );

  return {
    success: canEditRegions.every((c) => c.success),
    results: canEditRegions,
  };
};
