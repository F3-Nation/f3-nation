"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { UserRole } from "@/lib/types";

interface RoleListProps {
  roles: UserRole[];
}

export function RoleList({ roles: initialRoles }: RoleListProps) {
  const [roles, setRoles] = useState(initialRoles);
  const [removing, setRemoving] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRemove = async (role: UserRole) => {
    const key = `${role.orgId}-${role.roleId}`;
    setRemoving(key);

    try {
      const res = await fetch("/api/profile/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: role.orgId, roleId: role.roleId }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to remove role");
      }

      setRoles((prev) =>
        prev.filter(
          (r) => !(r.orgId === role.orgId && r.roleId === role.roleId),
        ),
      );
      toast({
        title: "Role removed",
        description: `Removed ${role.roleName} role.`,
      });
    } catch (err) {
      toast({
        title: "Failed to remove role",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(null);
    }
  };

  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">No roles assigned.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => {
          const key = `${role.orgId}-${role.roleId}`;
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
