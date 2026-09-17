"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

import { isValidF3Name } from "@acme/shared/app/functions";
import { useDebounce } from "~/utils/hooks/use-debounce";
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

import { client } from "~/orpc/client";
import type { RouterOutputs } from "~/orpc/types";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import {
  DeleteType,
  ModalType,
  closeModal,
  openModal,
} from "~/utils/store/modal";
import { Avatar, AvatarFallback, AvatarImage } from "@acme/ui/avatar";
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
const USER_SEARCH_PAGE_SIZE = 10;

export const AssignmentsTable = () => {
  const [selectedOrg, setSelectedOrg] = useState<AccessibleOrg | null>(null);

  const { data: orgs } = useFetchAllPages({
    queryKey: ["org.accessible.assignmentsTable"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs: page, total } = await client.org.accessible({
        pageIndex,
        pageSize,
      });
      return { items: page, total };
    },
  });

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
          <span className="text-xs text-muted-foreground italic">
            No users assigned
          </span>
        ) : (
          position.users.map((user) => (
            <Badge
              key={user.id}
              variant="secondary"
              className="flex items-center gap-1.5 border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
            >
              <Avatar className="h-5 w-5">
                {user.avatarUrl && (
                  <AvatarImage src={user.avatarUrl} alt={user.f3Name ?? ""} />
                )}
                <AvatarFallback className="bg-blue-600 text-[10px] font-semibold text-white dark:bg-blue-500">
                  {user.f3Name?.charAt(0) ?? user.firstName?.charAt(0) ?? "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {user.f3Name ?? user.firstName ?? `User #${user.id}`}
              </span>
              {canEdit && (
                <button
                  onClick={() =>
                    openModal(ModalType.DELETE_CONFIRMATION, {
                      type: DeleteType.ASSIGNMENT,
                      onConfirm: () => {
                        removeAssignment.mutate({
                          positionId: position.id,
                          orgId,
                          userId: user.id,
                        });
                        closeModal();
                      },
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
  const [f3NameSearch, setF3NameSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [assigningUserId, setAssigningUserId] = useState<number | null>(null);
  const debouncedF3Name = useDebounce(f3NameSearch.trim(), 300);
  const f3NameIsValid = isValidF3Name(debouncedF3Name);

  const {
    data: userByF3NameData,
    isLoading,
    isFetching,
  } = useQuery(
    orpc.user.byF3Name.queryOptions({
      input: {
        f3Name: debouncedF3Name,
        pageIndex,
        pageSize: USER_SEARCH_PAGE_SIZE,
      },
      enabled: f3NameIsValid,
    }),
  );

  const addAssignment = useMutation(
    orpc.position.addAssignment.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("position");
        toast.success("User assigned");
      },
      onError: (err) => {
        setAssigningUserId(null);
        toast.error(
          err instanceof ORPCError && err.code === "UNAUTHORIZED"
            ? "You are not authorized to manage assignments for this org"
            : "Failed to assign user",
        );
      },
      onSettled: () => {
        setAssigningUserId(null);
      },
    }),
  );

  const matchedUsers = useMemo(
    () => userByF3NameData?.users ?? [],
    [userByF3NameData?.users],
  );

  const totalCount = userByF3NameData?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / USER_SEARCH_PAGE_SIZE));
  const rangeStart =
    totalCount === 0 ? 0 : pageIndex * USER_SEARCH_PAGE_SIZE + 1;
  const rangeEnd = Math.min(
    (pageIndex + 1) * USER_SEARCH_PAGE_SIZE,
    totalCount,
  );
  const canGoPrevious = pageIndex > 0;
  const canGoNext = pageIndex < pageCount - 1;

  const getUserDisplayName = (user: (typeof matchedUsers)[number]) => {
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
          Enter the user&apos;s F3 name to find and assign them.
        </p>

        <div className="flex flex-col gap-3">
          <Command
            className="overflow-visible rounded-lg border"
            shouldFilter={false}
          >
            <CommandInput
              placeholder="e.g. Dredd"
              value={f3NameSearch}
              onValueChange={(value) => {
                setF3NameSearch(value);
                setPageIndex(0);
              }}
            />

            {!isLoading && f3NameIsValid && matchedUsers.length > 0 && (
              <>
                <div
                  className={cn(
                    "flex flex-col",
                    matchedUsers.length > 5 &&
                      "max-h-[360px] overflow-y-auto pr-1",
                  )}
                >
                  {matchedUsers.map((matchedUser) => {
                    const isAlreadyAssigned = assignedUserIds.includes(
                      matchedUser.id,
                    );
                    const isAssigningThisUser =
                      addAssignment.isPending &&
                      assigningUserId === matchedUser.id;

                    return (
                      <div
                        key={matchedUser.id}
                        className={cn(
                          "flex items-center justify-between border-b p-3",
                          {
                            "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950":
                              isAlreadyAssigned,
                            "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950":
                              !isAlreadyAssigned,
                          },
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {getUserDisplayName(matchedUser)}
                          </span>
                          {matchedUser.homeRegion?.homeRegionName && (
                            <span className="text-xs text-muted-foreground">
                              {matchedUser.homeRegion.homeRegionName}
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
                            onClick={() => {
                              setAssigningUserId(matchedUser.id);
                              addAssignment.mutate({
                                positionId,
                                orgId,
                                userId: matchedUser.id,
                              });
                            }}
                            disabled={isAssigningThisUser}
                          >
                            {isAssigningThisUser ? (
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
                    );
                  })}
                </div>

                {totalCount > USER_SEARCH_PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {isFetching
                        ? "Loading…"
                        : `${rangeStart}–${rangeEnd} of ${totalCount}`}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        disabled={!canGoPrevious || isFetching}
                        onClick={() =>
                          setPageIndex((prev) => Math.max(0, prev - 1))
                        }
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Previous page</span>
                      </Button>
                      <span className="min-w-[4.5rem] text-center text-xs text-muted-foreground">
                        Page {pageIndex + 1} of {pageCount}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        disabled={!canGoNext || isFetching}
                        onClick={() =>
                          setPageIndex((prev) =>
                            Math.min(pageCount - 1, prev + 1),
                          )
                        }
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="sr-only">Next page</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {isLoading && f3NameIsValid && (
              <div className="flex justify-center py-4">
                <Spinner className="size-5" />
              </div>
            )}
            {!isLoading && f3NameIsValid && matchedUsers.length === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">
                No user found with that F3 name.
              </p>
            )}

            {!f3NameIsValid && debouncedF3Name.length > 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Please enter at least 3 characters.
              </p>
            )}
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
}
