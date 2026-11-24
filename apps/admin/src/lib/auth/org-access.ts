import { ORG_TREE_MAX_DEPTH } from "@acme/shared/app/org-hierarchy";

import type { AdminSessionRole } from "./session";

/**
 * Whether the session holds editor or admin on `orgId` or on any org above
 * it. Must grant the same orgs as the API's `checkHasRoleOnOrg` for the
 * editor role, or a logo becomes replaceable by someone who can't edit the
 * org, or blocked for someone who can.
 */
export async function canEditOrg(
  orgId: number,
  roles: readonly Pick<AdminSessionRole, "orgId" | "roleName">[],
  getParentId: (orgId: number) => Promise<number | null | undefined>,
): Promise<boolean> {
  const editableOrgIds = new Set(
    roles
      .filter((role) => role.roleName === "editor" || role.roleName === "admin")
      .map((role) => role.orgId),
  );
  if (editableOrgIds.size === 0) return false;

  const visited = new Set<number>();
  let current: number | null | undefined = orgId;
  for (let depth = 0; depth <= ORG_TREE_MAX_DEPTH; depth++) {
    if (current === null || current === undefined || visited.has(current)) {
      return false;
    }
    if (editableOrgIds.has(current)) return true;
    visited.add(current);
    current = await getParentId(current);
  }
  return false;
}
