"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { isValidEmail } from "@acme/shared/app/functions";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Command, CommandInput } from "@acme/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import { Spinner } from "@acme/ui/spinner";
import { toast } from "@acme/ui/toast";

import type { RouterOutputs } from "~/orpc/types";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

type AccessibleOrg = RouterOutputs["org"]["accessible"]["orgs"][number];
type PositionWithAssignments =
  RouterOutputs["position"]["getAssignments"]["positions"][number];

const ORG_TYPE_ORDER: Record<string, number> = {
  nation: 0,
  sector: 1,
  area: 2,
  region: 3,
  ao: 4,
};

const ORG_TYPE_ORDER_FALLBACK = 99;

export const AssignmentsTable = () => {
  const [selectedOrg, setSelectedOrg] = useState<AccessibleOrg | null>(null);

  const { data: accessibleOrgs } = useQuery(
    orpc.org.accessible.queryOptions({}),
  );

  const orgs = accessibleOrgs?.orgs;

  const sortedOrgs = useMemo(() => {
    if (!orgs) return [];
    return orgs.slice().sort((a, b) => {
      const typeOrder =
        (ORG_TYPE_ORDER[a.orgType] ?? ORG_TYPE_ORDER_FALLBACK) -
        (ORG_TYPE_ORDER[b.orgType] ?? ORG_TYPE_ORDER_FALLBACK);
      if (typeOrder !== 0) return typeOrder;
      return a.name.localeCompare(b.name);
    });
  }, [orgs]);

  const orgOptions = useMemo(
    () =>
      sortedOrgs.map((org) => ({
        value: org.id.toString(),
        label: `(${org.orgType.toUpperCase()}) ${org.name}`,
      })),
    [sortedOrgs],
  );

  useEffect(() => {
    if (!selectedOrg && sortedOrgs.length > 0) {
      setSelectedOrg(sortedOrgs[0]!);
    }
  }, [sortedOrgs, selectedOrg]);

  const { data: assignmentsData, isLoading: isLoadingAssignments } = useQuery(
    orpc.position.getAssignments.queryOptions({
      input: { orgId: selectedOrg?.id ?? -1 },
      enabled: !!selectedOrg,
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-sm font-medium">Organization:</span>
        <div className="w-full sm:max-w-sm">
          <VirtualizedCombobox
            options={orgOptions}
            value={selectedOrg?.id.toString()}
            searchPlaceholder="Select an organization..."
            hideClearButton
            onSelect={(value) => {
              const org = orgs?.find((o) => o.id.toString() === value);
              if (org) setSelectedOrg(org);
            }}
          />
        </div>
      </div>

      {!selectedOrg && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select an organization above to view and manage position assignments.
        </p>
      )}

      {selectedOrg && isLoadingAssignments && (
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}

      {selectedOrg && !isLoadingAssignments && assignmentsData && (
        <PositionSections
          positions={assignmentsData.positions}
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          canEdit={
            selectedOrg.roles.length === 0 ||
            selectedOrg.roles.includes("editor") ||
            selectedOrg.roles.includes("admin")
          }
        />
      )}
    </div>
  );
};

function PositionSections({
  positions,
  orgId,
  orgName,
  canEdit,
}: {
  positions: PositionWithAssignments[];
  orgId: number;
  orgName: string;
  canEdit: boolean;
}) {
  if (positions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No positions are available for this organization.
      </p>
    );
  }

  const nationalPositions = positions.filter((p) => p.orgId === null);
  const orgPositions = positions.filter((p) => p.orgId !== null);

  return (
    <div className="flex flex-col gap-4">
      {nationalPositions.length > 0 && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 pb-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              National Positions
            </h2>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              Nation-wide
            </Badge>
          </div>
          <div className="divide-y">
            {nationalPositions.map((position) => (
              <PositionAssignmentRow
                key={position.id}
                position={position}
                orgId={orgId}
                canEdit={canEdit}
              />
            ))}
          </div>
        </div>
      )}

      {orgPositions.length > 0 && (
        <div className="flex flex-col">
          <h2 className="pb-2 text-sm font-semibold text-muted-foreground">
            {orgName} Positions
          </h2>
          <div className="divide-y">
            {orgPositions.map((position) => (
              <PositionAssignmentRow
                key={position.id}
                position={position}
                orgId={orgId}
                canEdit={canEdit}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionAssignmentRow({
  position,
  orgId,
  canEdit,
}: {
  position: PositionWithAssignments;
  orgId: number;
  canEdit: boolean;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const removeAssignment = useMutation(
    orpc.position.deleteAssignment.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("position");
        toast.success("Assignment removed");
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err.code === "UNAUTHORIZED"
            ? "You are not authorized to manage assignments for this org"
            : "Failed to remove assignment",
        );
      },
    }),
  );

  return (
    <div className="py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{position.name}</h3>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1 h-3 w-3" />
            Assign
          </Button>
        )}
      </div>

      {position.description && (
        <p className="mb-2 text-xs text-muted-foreground">
          {position.description}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {position.users.length === 0 ? (
          <span className="text-xs italic text-muted-foreground">
            No users assigned
          </span>
        ) : (
          position.users.map((user) => (
            <Badge
              key={user.id}
              variant="secondary"
              className="flex items-center gap-1 border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
            >
              {user.f3Name ?? user.firstName ?? `User #${user.id}`}
              {canEdit && (
                <button
                  onClick={() =>
                    removeAssignment.mutate({
                      positionId: position.id,
                      orgId,
                      userId: user.id,
                    })
                  }
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))
        )}
      </div>

      {addDialogOpen && canEdit && (
        <AddUserDialog
          positionId={position.id}
          orgId={orgId}
          assignedUserIds={position.users.map((u) => u.id)}
          onClose={() => setAddDialogOpen(false)}
        />
      )}
    </div>
  );
}

function AddUserDialog({
  positionId,
  orgId,
  assignedUserIds,
  onClose,
}: {
  positionId: number;
  orgId: number;
  assignedUserIds: number[];
  onClose: () => void;
}) {
  const [emailSearch, setEmailSearch] = useState("");
  const emailToSearch = emailSearch.trim();
  const emailIsValid = isValidEmail(emailToSearch);

  const { data: userByEmailData, isLoading } = useQuery(
    orpc.user.byEmail.queryOptions({
      input: { email: emailToSearch },
      enabled: emailIsValid,
    }),
  );

  const addAssignment = useMutation(
    orpc.position.addAssignment.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("position");
        toast.success("User assigned");
        onClose();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err.code === "UNAUTHORIZED"
            ? "You are not authorized to manage assignments for this org"
            : "Failed to assign user",
        );
      },
    }),
  );

  const matchedUser = userByEmailData?.user ?? null;
  const isAlreadyAssigned =
    matchedUser !== null && assignedUserIds.includes(matchedUser.id);

  const getUserDisplayName = (user: NonNullable<typeof matchedUser>) => {
    if (user.f3Name && user.firstName) {
      return `${user.f3Name} (${user.firstName} ${user.lastName ?? ""})`.trim();
    }
    return user.f3Name ?? user.firstName ?? `User #${user.id}`;
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign User to Position</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Enter the user&apos;s email address to find and assign them.
        </p>

        <div className="flex flex-col gap-3">
          <Command
            className="overflow-visible rounded-lg border"
            shouldFilter={false}
          >
            <CommandInput
              placeholder="user@example.com"
              value={emailSearch}
              onValueChange={setEmailSearch}
            />
          </Command>

          {isLoading && emailIsValid && (
            <div className="flex items-center justify-center py-4">
              <Spinner className="size-4" />
            </div>
          )}

          {!isLoading && emailIsValid && matchedUser && (
            <div
              className={cn(
                "flex items-center justify-between rounded-lg border p-3",
                isAlreadyAssigned
                  ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
                  : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
              )}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {getUserDisplayName(matchedUser)}
                </span>
                {matchedUser.email && (
                  <span className="text-xs text-muted-foreground">
                    {matchedUser.email}
                  </span>
                )}
              </div>
              {isAlreadyAssigned ? (
                <Badge
                  variant="outline"
                  className="shrink-0 text-yellow-700 dark:text-yellow-300"
                >
                  Already assigned
                </Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    addAssignment.mutate({
                      positionId,
                      orgId,
                      userId: matchedUser.id,
                    })
                  }
                  disabled={addAssignment.isPending}
                >
                  {addAssignment.isPending ? (
                    <Spinner className="size-3" />
                  ) : (
                    <>
                      <Plus className="mr-1 h-3 w-3" />
                      Assign
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {!isLoading && emailIsValid && !matchedUser && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              No user found with that email address.
            </p>
          )}

          {!emailIsValid && emailToSearch.length > 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Please enter a valid email address.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
