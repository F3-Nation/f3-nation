import type { OrgType, UserRole } from "@acme/shared/app/enums";
import {
  ROLE_ORG_TYPES,
  roleAllowedOnOrgType,
} from "@acme/shared/app/permissions";

interface RoleDisplay {
  label: string;
  /** One line under the role picker saying what the role lets someone do. */
  description: string;
  badgeClassName: string;
  /** False keeps the role out of the role picker; it still shows in badges. */
  assignable: boolean;
}

/**
 * How admin shows each role, most access first. Typed over every `UserRole`,
 * so a new role fails typecheck until it has an entry here.
 */
export const ROLE_DISPLAY = {
  admin: {
    label: "Admin",
    description: "Admins can invite and edit",
    badgeClassName: "bg-purple-100 text-purple-700 border-purple-200",
    assignable: true,
  },
  editor: {
    label: "Editor",
    description: "Editors can edit",
    badgeClassName: "bg-blue-100 text-blue-700 border-blue-200",
    assignable: true,
  },
  password_manager: {
    label: "Password Manager",
    description:
      "Password Managers can add and edit the region's vault passwords",
    badgeClassName: "bg-amber-100 text-amber-800 border-amber-200",
    assignable: true,
  },
  password_reader: {
    label: "Password Reader",
    description: "Password Readers can view the region's vault passwords",
    badgeClassName: "bg-teal-100 text-teal-700 border-teal-200",
    assignable: true,
  },
  user: {
    label: "User",
    description: "Users have no extra access",
    badgeClassName: "bg-green-100 text-green-700 border-green-200",
    assignable: false,
  },
} as const satisfies Record<UserRole, RoleDisplay>;

/** Every role in display order, most access first. */
export const ROLES_IN_DISPLAY_ORDER = Object.keys(ROLE_DISPLAY) as UserRole[];

const FALLBACK_BADGE_CLASS = "bg-muted text-muted-foreground border-muted";

/** False for a null or for a role name this build doesn't know. */
export function isUserRole(roleName: string | null): roleName is UserRole {
  return roleName !== null && Object.hasOwn(ROLE_DISPLAY, roleName);
}

function displayFor(roleName: string | null): RoleDisplay | undefined {
  return isUserRole(roleName) ? ROLE_DISPLAY[roleName] : undefined;
}

/** A role's label; a role name this build doesn't know is shown as is. */
export function roleLabel(roleName: string | null): string {
  return displayFor(roleName)?.label ?? roleName ?? "Unknown";
}

/**
 * Roles the picker offers on an org of the given type, in display order: the
 * assignable roles the API allows on that type. With no type known, only
 * roles allowed on every type.
 */
export function assignableRoles(orgType: OrgType | undefined): UserRole[] {
  return ROLES_IN_DISPLAY_ORDER.filter((role) => {
    const display: RoleDisplay = ROLE_DISPLAY[role];
    if (!display.assignable) return false;
    return orgType === undefined
      ? !Object.hasOwn(ROLE_ORG_TYPES, role)
      : roleAllowedOnOrgType(role, orgType);
  });
}

function displayRank(roleName: string | null): number {
  const index = ROLES_IN_DISPLAY_ORDER.indexOf(roleName as UserRole);
  return index === -1 ? ROLES_IN_DISPLAY_ORDER.length : index;
}

export interface OrgRoles {
  orgId: number;
  orgName: string | null;
  /** Most access first. */
  roleNames: string[];
}

/**
 * Group role assignments by org, keeping the order each org first appears in
 * and sorting each org's roles most access first.
 */
export function groupRolesByOrg(
  roles: readonly {
    orgId: number;
    orgName?: string | null;
    roleName: string | null;
  }[],
): OrgRoles[] {
  const byOrg = new Map<number, OrgRoles>();
  for (const role of roles) {
    const group = byOrg.get(role.orgId) ?? {
      orgId: role.orgId,
      orgName: role.orgName ?? null,
      roleNames: [],
    };
    if (role.roleName && !group.roleNames.includes(role.roleName))
      group.roleNames.push(role.roleName);
    byOrg.set(role.orgId, group);
  }
  return [...byOrg.values()].map((group) => ({
    ...group,
    roleNames: [...group.roleNames].sort(
      (a, b) => displayRank(a) - displayRank(b),
    ),
  }));
}

/** The badge style for an org's roles: that of its highest-access role. */
export function badgeClassFor(roleNames: readonly string[]): string {
  return (
    displayFor(roleNames[0] ?? null)?.badgeClassName ?? FALLBACK_BADGE_CLASS
  );
}

/** A user's roles as the `{ orgId, roleName }` pairs `user.crupdate` takes. */
export function toRoleAssignments(
  roles: readonly { orgId: number; roleName: UserRole }[] | null | undefined,
): { orgId: number; roleName: UserRole }[] {
  return (roles ?? []).map(({ orgId, roleName }) => ({ orgId, roleName }));
}

/** Each org name once, in the order the roles list them. */
export function uniqueOrgNames(
  roles: readonly { orgName: string | null }[],
): string[] {
  return [
    ...new Set(roles.flatMap((role) => (role.orgName ? [role.orgName] : []))),
  ];
}
