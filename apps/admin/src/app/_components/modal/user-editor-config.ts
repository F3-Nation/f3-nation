import type { OrgType } from "@acme/shared/app/enums";

interface EditableOrg {
  id: number;
  orgType: OrgType;
}

/**
 * Mirrors the server's user.crupdate profile scope: anyone may fill a new
 * user or their own profile; otherwise the caller needs an editable org that
 * covers the user's home region, else one of their role orgs, else Nation.
 */
export const canEditUserProfile = ({
  user,
  sessionUserId,
  editableOrgs,
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
}): boolean => {
  if (!user?.id) return true;
  if (sessionUserId === user.id) return true;

  const editableOrgIds = new Set(editableOrgs.map((org) => org.id));
  if (user.homeRegionId != null) return editableOrgIds.has(user.homeRegionId);

  const roleOrgIds = (user.roles ?? []).map((role) => role.orgId);
  if (roleOrgIds.length > 0) {
    return roleOrgIds.some((orgId) => editableOrgIds.has(orgId));
  }
  return editableOrgs.some((org) => org.orgType === "nation");
};
