"use client";

import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useRemovableList, compositeKey } from "@/hooks/useRemovableList";
import type { UserRole } from "@/lib/types";

interface RoleListProps {
  roles: UserRole[];
}

export function RoleList({ roles: initialRoles }: RoleListProps) {
  const { toast } = useToast();
  const {
    items: roles,
    removing,
    handleRemove,
  } = useRemovableList({
    initialItems: initialRoles,
    getKey: (r) => compositeKey(r.orgId, r.roleId),
    endpoint: "/api/profile/roles",
    buildDeleteBody: (r) => ({ orgId: r.orgId, roleId: r.roleId }),
    shouldKeep: (item, removed) =>
      !(item.orgId === removed.orgId && item.roleId === removed.roleId),
    toast,
    successMessage: (r) => ({
      title: "Role removed",
      description: `Removed ${r.roleName} role.`,
    }),
    failureTitle: "Failed to remove role",
  });

  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">No roles assigned.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => {
          const key = compositeKey(role.orgId, role.roleId);
          return (
            <Badge
              key={key}
              variant="secondary"
              className="flex items-center gap-1.5 pr-1"
            >
              <span>
                {role.orgName ?? `Org ${role.orgId}`} — {role.roleName}
              </span>
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                disabled={removing === key}
                onClick={() => handleRemove(role)}
                aria-label={`Remove ${role.roleName} role from ${role.orgName ?? `Org ${role.orgId}`}`}
              >
                {removing === key ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 2L10 10M2 10L10 2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
            </Badge>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        To add a new role, contact your region admins. Check{" "}
        <a
          href="https://org.f3nation.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          org.f3nation.com
        </a>{" "}
        to find admins.
      </p>
    </div>
  );
}
