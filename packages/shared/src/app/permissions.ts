import type { OrgType, UserRole } from "./enums";

export interface PermissionDefinition {
  /** The stable id, in `resource.action` form. */
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
}

/**
 * What the API checks before an action. Code asks for a permission; people and
 * API keys are given roles, and each role is a named bundle of permissions.
 * `displayName` and `description` are shown to API users. Every entry is
 * permanent API surface: splitting one later is cheap, merging two is not.
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

/**
 * False for a role name that isn't in `ROLE_PERMISSIONS`. A session's role
 * names come from the database, which can hold a role this build has no
 * entry for.
 */
export const roleHasPermission = (
  roleName: UserRole,
  permission: Permission,
): boolean =>
  Object.hasOwn(ROLE_PERMISSIONS, roleName) &&
  ROLE_PERMISSIONS[roleName].some(({ name }) => name === permission.name);

/**
 * The org types a role can be given on. A role not listed here can be given on
 * an org of any type. The API refuses a grant outside these types, and the
 * admin site offers each role only where it is allowed.
 */
export const ROLE_ORG_TYPES: Partial<Record<UserRole, readonly OrgType[]>> = {
  // The password vault keeps one collection per region.
  password_manager: ["region"],
  password_reader: ["region"],
};

/** True when `roleName` can be given on an org of type `orgType`. */
export const roleAllowedOnOrgType = (
  roleName: UserRole,
  orgType: OrgType,
): boolean => {
  const allowed = Object.hasOwn(ROLE_ORG_TYPES, roleName)
    ? ROLE_ORG_TYPES[roleName]
    : undefined;
  return allowed === undefined || allowed.includes(orgType);
};
