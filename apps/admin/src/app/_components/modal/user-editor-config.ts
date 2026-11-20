import type { OrgType } from "@acme/shared/app/enums";

interface EditableOrg {
  id: number;
  orgType: OrgType;
}

/**
 * Mirrors the server's user.crupdate profile scope: anyone may fill a new
 * user or their own profile; otherwise the caller needs an editable org that
 * covers the user's home region, or Nation for a user with none.
 */
export const canEditUserProfile = ({
  user,
  sessionUserId,
  editableOrgs,
}: {
  user: { id?: number | null; homeRegionId?: number | null } | null | undefined;
  sessionUserId: number | undefined;
  editableOrgs: readonly EditableOrg[];
}): boolean => {
  if (!user?.id) return true;
  if (sessionUserId === user.id) return true;

  if (user.homeRegionId != null) {
    return editableOrgs.some((org) => org.id === user.homeRegionId);
  }
  return editableOrgs.some((org) => org.orgType === "nation");
};
