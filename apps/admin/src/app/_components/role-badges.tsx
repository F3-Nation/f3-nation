import { cn } from "@acme/ui";

import { badgeClassFor, groupRolesByOrg, roleLabel } from "~/lib/roles";

/** One badge per org listing the user's roles there, e.g. "Boone (Admin, Password Manager)". */
export function RoleBadges({
  roles,
  className,
  badgeClassName,
}: {
  roles: readonly {
    orgId: number;
    orgName?: string | null;
    roleName: string | null;
  }[];
  className?: string;
  badgeClassName?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {groupRolesByOrg(roles).map((group) => (
        <span
          key={`org-${group.orgId}`}
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
            badgeClassFor(group.roleNames),
            badgeClassName,
          )}
        >
          {`${group.orgName ?? `Org #${group.orgId}`} (${group.roleNames.map(roleLabel).join(", ")})`}
        </span>
      ))}
    </div>
  );
}
