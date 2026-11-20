"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { OrgType, UserRole } from "@acme/shared/app/enums";
import { safeParseInt } from "@acme/shared/common/functions";
import { Button } from "@acme/ui/button";
import { MultiSelect } from "@acme/ui/multi-select";
import { toast } from "@acme/ui/toast";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import {
  ROLE_DISPLAY,
  ROLES_IN_DISPLAY_ORDER,
  assignableRoles,
  groupRolesByOrg,
  roleLabel,
} from "~/lib/roles";

export interface RoleAssignment {
  orgId: number;
  roleName: UserRole;
}

export interface RoleOrgOption {
  id: number;
  name: string;
  orgType?: OrgType;
}

/** An org row in the editor. `orgId` is -1 until an org is chosen. */
interface Row {
  key: number;
  orgId: number;
  roleNames: UserRole[];
  /**
   * Added with "Add organization", or moved to another org: either way it
   * must have a role before saving, or the save would grant nothing there.
   */
  needsRole?: boolean;
}

const NO_ORG = -1;

function toRows(value: readonly RoleAssignment[], firstKey: number): Row[] {
  return groupRolesByOrg(value).map((group, index) => ({
    key: firstKey + index,
    orgId: group.orgId,
    roleNames: group.roleNames as UserRole[],
  }));
}

/**
 * Rows back to the flat list the API takes. A row with roles but no org keeps
 * `orgId` -1 so the form can refuse to save it; a row with no roles adds
 * nothing.
 */
function toAssignments(rows: readonly Row[]): RoleAssignment[] {
  return rows.flatMap((row) =>
    row.roleNames.map((roleName) => ({ orgId: row.orgId, roleName })),
  );
}

const assignmentsKey = (roles: readonly RoleAssignment[]) =>
  roles.map((role) => `${role.orgId}:${role.roleName}`).join(",");

const sameAssignments = (
  a: readonly RoleAssignment[],
  b: readonly RoleAssignment[],
) => assignmentsKey(a) === assignmentsKey(b);

/**
 * Edits a user's roles as one row per org, each with a multi-select of roles.
 * Rows for orgs outside `orgOptions` are shown read-only and kept as they are,
 * so a save resubmits them unchanged.
 */
export function RoleAssignmentsField({
  value,
  onChange,
  orgOptions,
  orgNames,
  isLoadingOrgs = false,
  orgsFailed = false,
  orgPlaceholder = "Select an organization",
  onIncompleteChange,
}: {
  value: readonly RoleAssignment[];
  onChange: (roles: RoleAssignment[]) => void;
  orgOptions: readonly RoleOrgOption[];
  /** Names for orgs not in `orgOptions`, for their read-only rows. */
  orgNames?: ReadonlyMap<number, string>;
  isLoadingOrgs?: boolean;
  /**
   * The org list failed to load. Every row then shows read-only and no org
   * can be added, so the field says why rather than looking empty.
   */
  orgsFailed?: boolean;
  orgPlaceholder?: string;
  /**
   * Told whether an added or moved org has no role chosen yet. Such a row adds nothing
   * to the value, so a form that saved it would silently grant nothing.
   */
  onIncompleteChange?: (incomplete: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value, 0));
  const [nextKey, setNextKey] = useState(rows.length);
  const [syncedValue, setSyncedValue] = useState(value);

  // Rebuild the rows when the form value changes from outside (a user loads,
  // the form resets), but not when it is just echoing this editor's output.
  if (value !== syncedValue && !sameAssignments(value, toAssignments(rows))) {
    setSyncedValue(value);
    setRows(toRows(value, nextKey));
    setNextKey(nextKey + value.length);
  } else if (value !== syncedValue) {
    setSyncedValue(value);
  }

  const incomplete = rows.some(
    (row) =>
      row.needsRole && row.orgId !== NO_ORG && row.roleNames.length === 0,
  );
  useEffect(() => {
    onIncompleteChange?.(incomplete);
  }, [incomplete, onIncompleteChange]);

  const update = (nextRows: Row[]) => {
    setRows(nextRows);
    const assignments = toAssignments(nextRows);
    setSyncedValue(assignments);
    onChange(assignments);
  };

  const optionById = new Map(orgOptions.map((org) => [org.id, org]));

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const org = optionById.get(row.orgId);

        if (row.orgId !== NO_ORG && !org) {
          return (
            <div
              key={row.key}
              className="flex flex-col gap-2 rounded-md border border-input p-2 opacity-50 sm:flex-row sm:items-center sm:border-0 sm:p-0"
            >
              <div className="flex h-9 flex-1 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {orgNames?.get(row.orgId) ?? `Org #${row.orgId}`}
              </div>
              <div className="flex min-h-9 flex-1 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {row.roleNames.map(roleLabel).join(", ")}
              </div>
              <div className="hidden h-8 w-8 sm:block" />
            </div>
          );
        }

        const usedOrgIds = new Set(
          rows.filter((other) => other !== row).map((other) => other.orgId),
        );
        const offered = assignableRoles(org?.orgType);
        // Keep roles the user already holds selectable so they can be removed,
        // even where the picker wouldn't offer them.
        const roleOptions = ROLES_IN_DISPLAY_ORDER.filter(
          (role) => offered.includes(role) || row.roleNames.includes(role),
        ).map((role) => ({ value: role, label: ROLE_DISPLAY[role].label }));

        return (
          <div
            key={row.key}
            className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-start sm:border-0 sm:p-0"
          >
            <div className="sm:w-1/2">
              <VirtualizedCombobox
                value={row.orgId === NO_ORG ? undefined : row.orgId.toString()}
                options={orgOptions
                  .filter((option) => !usedOrgIds.has(option.id))
                  .map((option) => ({
                    value: option.id.toString(),
                    label: option.orgType
                      ? `${option.name} (${option.orgType})`
                      : option.name,
                  }))}
                searchPlaceholder={orgPlaceholder}
                disabled={isLoadingOrgs}
                onSelect={(selected) => {
                  const orgId = safeParseInt(selected);
                  if (orgId == undefined) {
                    toast.error("Invalid orgId");
                    return;
                  }
                  // The picker reports a reselection of the current org too.
                  if (orgId === row.orgId) return;
                  // Drop roles the new org's type doesn't offer.
                  const allowed = assignableRoles(
                    optionById.get(orgId)?.orgType,
                  );
                  update(
                    rows.map((other) =>
                      other === row
                        ? {
                            ...row,
                            orgId,
                            roleNames: row.roleNames.filter((role) =>
                              allowed.includes(role),
                            ),
                            needsRole: true,
                          }
                        : other,
                    ),
                  );
                }}
                isMulti={false}
              />
            </div>
            <MultiSelect
              className="sm:w-1/2"
              hideSelectAll
              maxCount={4}
              options={roleOptions}
              defaultValue={row.roleNames}
              placeholder="Select roles"
              aria-label="Roles"
              onValueChange={(selected) =>
                update(
                  rows.map((other) =>
                    other === row
                      ? {
                          ...row,
                          roleNames: ROLES_IN_DISPLAY_ORDER.filter((role) =>
                            selected.includes(role),
                          ),
                        }
                      : other,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              type="button"
              size="sm"
              aria-label="Remove organization"
              className="self-end sm:self-auto"
              onClick={() => update(rows.filter((other) => other !== row))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {orgsFailed && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the organizations you manage. Reload and try again.
        </p>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          {ROLES_IN_DISPLAY_ORDER.filter(
            (role) => ROLE_DISPLAY[role].assignable,
          ).map((role) => (
            <p key={role} className="text-xs text-gray-500">
              {ROLE_DISPLAY[role].description}
            </p>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 shrink-0"
          disabled={orgsFailed}
          onClick={() => {
            // No org preselected, so a save can't land on the wrong one.
            setRows([
              ...rows,
              { key: nextKey, orgId: NO_ORG, roleNames: [], needsRole: true },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add organization
        </Button>
      </div>
    </div>
  );
}
