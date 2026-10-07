// Roles the admin portal surfaces. The role enum (@acme/shared UserRole) also
// carries roles that are intentionally not exposed in admin yet (e.g.
// password_manager, password_reader); everything here filters the wider
// session/API role list down to this set via isAdminRoleName so those roles
// never render or become selectable in the portal.
export const ADMIN_VISIBLE_ROLES = ["user", "editor", "admin"] as const;

type AdminRoleName = (typeof ADMIN_VISIBLE_ROLES)[number];

export function isAdminRoleName(
  roleName: string | null | undefined,
): roleName is AdminRoleName {
  return (ADMIN_VISIBLE_ROLES as readonly string[]).includes(roleName ?? "");
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
