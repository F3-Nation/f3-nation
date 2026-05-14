export type AdminRoleName = "admin" | "editor" | "user";

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
