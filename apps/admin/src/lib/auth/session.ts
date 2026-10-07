import { GrantableUserRole } from "@acme/shared/app/enums";
import type { GrantableUserRole as GrantableUserRoleName } from "@acme/shared/app/enums";

// Roles the admin portal surfaces. The role enum (@acme/shared UserRole) also
// carries roles that are intentionally not exposed in admin yet (e.g.
// password_manager, password_reader); everything here filters the wider
// session/API role list down to this set via isAdminRoleName so those roles
// never render or become selectable in the portal. This mirrors the
// system-wide "currently active" set so admin visibility and API grantability
// never drift apart.
export const ADMIN_VISIBLE_ROLES = GrantableUserRole;

type AdminRoleName = (typeof ADMIN_VISIBLE_ROLES)[number];

export function isAdminRoleName(
  roleName: string | null | undefined,
): roleName is AdminRoleName {
  return (ADMIN_VISIBLE_ROLES as readonly string[]).includes(roleName ?? "");
}

/**
 * Keep only grantable role assignments and narrow them to the assignable role
 * union, for populating role-editing forms. Dormant roles (password_*) are
 * dropped here so they can't be mislabeled or overwritten; user.crupdate
 * preserves those assignments on save instead of deleting them.
 */
export function toGrantableRoleEntries(
  roles: readonly { orgId: number; roleName: string }[] | null | undefined,
): { orgId: number; roleName: GrantableUserRoleName }[] {
  return (roles ?? []).flatMap((role) =>
    isAdminRoleName(role.roleName)
      ? [{ orgId: role.orgId, roleName: role.roleName }]
      : [],
  );
}

export interface AdminSessionRole {
  roleId?: number;
  orgId: number;
  orgName: string;
  roleName: AdminRoleName;
}

export interface AdminSession {
  // SSO subject is represented as a string in token/userinfo payloads.
  sub: string;
  // Internal admin code historically reads a numeric `id` from the session.
  id: number;
  email: string;
  name?: string;
  roles: AdminSessionRole[];
}
