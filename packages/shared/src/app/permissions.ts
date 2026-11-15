import type { UserRole } from "./enums";

/**
 * What the API checks before an action. Code asks for a permission; people
 * and API keys are granted roles, and each role is a named bundle of these
 * (ADR 0002). Every entry is permanent API surface: splitting one later is
 * cheap, merging two is not.
 */
export const PERMISSIONS = [
  "entities.manage",
  "security.manage",
  "messages.send",
  "pii.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The permissions each role grants, exhaustive over `UserRole`. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ["entities.manage", "security.manage", "messages.send", "pii.read"],
  editor: ["entities.manage", "messages.send", "pii.read"],
  user: [],
  // Dormant roles: not grantable yet, so they grant nothing.
  password_manager: [],
  password_reader: [],
};

export const roleHasPermission = (
  roleName: UserRole,
  permission: Permission,
): boolean => ROLE_PERMISSIONS[roleName].includes(permission);
