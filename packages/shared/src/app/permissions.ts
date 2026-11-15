import type { UserRole } from "./enums";

export interface PermissionDefinition {
  /** The stable id, in `resource.action` form. */
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
}

/**
 * What the API checks before an action. Code asks for a permission; people and
 * API keys are given roles, and each role is a named bundle of permissions
 * (docs/adr/0002-permission-based-authorization.md). `displayName` and
 * `description` are shown to API users. Every entry is permanent API surface:
 * splitting one later is cheap, merging two is not.
 */
export const Permission = {
  EntitiesManage: {
    name: "entities.manage",
    displayName: "Manage entities",
    description:
      "Create, edit and delete orgs, locations, events and other records.",
  },
  SecurityManage: {
    name: "security.manage",
    displayName: "Manage security",
    description: "Give and remove roles, and manage API keys.",
  },
  MessagesSend: {
    name: "messages.send",
    displayName: "Send messages",
    description: "Send and edit Slack messages through the API.",
  },
  PiiRead: {
    name: "pii.read",
    displayName: "Read personal information",
    description: "See people's personal information, such as email addresses.",
  },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** The permissions each role includes, exhaustive over `UserRole`. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    Permission.EntitiesManage,
    Permission.SecurityManage,
    Permission.MessagesSend,
    Permission.PiiRead,
  ],
  editor: [Permission.EntitiesManage, Permission.PiiRead],
  user: [],
  password_manager: [],
  password_reader: [],
};

export const roleHasPermission = (
  roleName: UserRole,
  permission: Permission,
): boolean =>
  ROLE_PERMISSIONS[roleName].some(({ name }) => name === permission.name);
