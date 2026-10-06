import type { OrgType } from "@acme/shared/app/enums";

interface EditableOrg {
  id: number;
  orgType: OrgType;
}

/**
 * Mirrors the server's user.crupdate profile scope: anyone may fill a new
 * user or their own profile; otherwise the caller needs an editable org that
 * covers the user's home region, else one of their role orgs, else Nation.
 * `editableOrgs` stops above AOs, so an AO role counts through its parent,
 * looked up in `roleOrgParentIds`.
 */
/** Role orgs whose parent is needed: not already editable, no home region. */
export const roleOrgIdsNeedingParent = ({
  user,
  editableOrgs,
}: {
  user:
    | { homeRegionId?: number | null; roles?: { orgId: number }[] | null }
    | null
    | undefined;
  editableOrgs: readonly EditableOrg[];
}): number[] => {
  if (!user || user.homeRegionId != null) return [];
  const editableOrgIds = new Set(editableOrgs.map((org) => org.id));
  return [...new Set((user.roles ?? []).map((role) => role.orgId))].filter(
    (orgId) => !editableOrgIds.has(orgId),
  );
};

export const canEditUserProfile = ({
  user,
  sessionUserId,
  editableOrgs,
  roleOrgParentIds,
}: {
  user:
    | {
        id?: number | null;
        homeRegionId?: number | null;
        roles?: { orgId: number }[] | null;
      }
    | null
    | undefined;
  sessionUserId: number | undefined;
  editableOrgs: readonly EditableOrg[];
  roleOrgParentIds?: ReadonlyMap<number, number | null>;
}): boolean => {
  if (!user?.id) return true;
  if (sessionUserId === user.id) return true;

  const editableOrgIds = new Set(editableOrgs.map((org) => org.id));
  if (user.homeRegionId != null) return editableOrgIds.has(user.homeRegionId);

  const roleOrgIds = (user.roles ?? []).map((role) => role.orgId);
  if (roleOrgIds.length > 0) {
    return roleOrgIds.some((orgId) => {
      if (editableOrgIds.has(orgId)) return true;
      const parentId = roleOrgParentIds?.get(orgId);
      return parentId != null && editableOrgIds.has(parentId);
    });
  }
  return editableOrgs.some((org) => org.orgType === "nation");
};
