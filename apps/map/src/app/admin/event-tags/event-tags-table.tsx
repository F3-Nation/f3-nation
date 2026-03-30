"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import type { SortingSchema } from "@acme/validators";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { MDTable, usePagination } from "@acme/ui/md-table";
import { Cell, Header } from "@acme/ui/table";

import type { RouterOutputs } from "~/orpc/types";
import { orpc, useQuery } from "~/orpc/react";
import { useDebounce } from "~/utils/hooks/use-debounce";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";
import { ResetFilter } from "../_components/reset-filter";
import { EventTypeIsActiveFilter } from "../event-types/event-type-is-active-filter";
import { OrgFilter } from "../event-types/org-filter";

type Org = RouterOutputs["org"]["accessible"]["orgs"][number];

export const EventTagsTable = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [sorting, setSorting] = useState<SortingSchema>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<Org[]>([]);
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const { pagination, setPagination } = usePagination({
    pageSize: 20,
  });

  const { data: accessibleOrgs } = useQuery(orpc.org.accessible.queryOptions());

  const orgIdsToUse =
    selectedOrgs.length > 0
      ? selectedOrgs.map((org) => org.id)
      : accessibleOrgs?.orgs.map((org) => org.id) ?? [];

  const { data: eventTagsResult } = useQuery({
    ...orpc.eventTag.all.queryOptions({
      input: {
        orgIds: orgIdsToUse,
        statuses: selectedStatuses,
        searchTerm: debouncedSearchTerm,
        pageSize: pagination.pageSize,
        pageIndex: pagination.pageIndex,
        ignoreNationEventTags: false,
        sorting: sorting,
      },
    }),
    enabled: accessibleOrgs !== undefined,
  });

  const handleOrgSelect = (org: Org) => {
    setSelectedOrgs((prev) => {
      if (prev.some((s) => s.id === org.id)) {
        return prev.filter((s) => s.id !== org.id);
      }
      return [...prev, org];
    });
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleStatusSelect = (status: IsActiveStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      }
      return [...prev, status];
    });
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleResetFilters = () => {
    setSelectedStatuses(["active"]);
    setSelectedOrgs([]);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const activeFilterCount =
    (selectedStatuses.length > 0 ? selectedStatuses.length : 0) +
    selectedOrgs.length;

  return (
    <MDTable
      data={eventTagsResult?.eventTags}
      totalCount={eventTagsResult?.totalCount}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      sorting={sorting}
      setSorting={setSorting}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_EVENT_TAGS, { id: row.original.id });
      }}
      filterComponent={
        <>
          <div className="hidden items-center gap-2 md:flex">
            <EventTypeIsActiveFilter
              onStatusSelect={handleStatusSelect}
              selectedStatuses={selectedStatuses}
            />
            <OrgFilter
              onOrgSelect={handleOrgSelect}
              selectedOrgs={selectedOrgs}
            />
            <ResetFilter onClick={handleResetFilters} />
          </div>
          <MobileFilterSheet
            activeFilterCount={activeFilterCount}
            onReset={handleResetFilters}
          >
            <div>
              <p className="mb-1 text-sm font-medium">Status</p>
              <EventTypeIsActiveFilter
                onStatusSelect={handleStatusSelect}
                selectedStatuses={selectedStatuses}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Organization</p>
              <OrgFilter
                onOrgSelect={handleOrgSelect}
                selectedOrgs={selectedOrgs}
              />
            </div>
          </MobileFilterSheet>
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["eventTag"]["all"]["eventTags"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "description",
    meta: { name: "Description" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "color",
    meta: { name: "Color" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "specificOrgName",
    accessorFn: (row) => row.specificOrgName,
    meta: { name: "Specific Org" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "isActive",
    meta: { name: "Status" },
    header: Header,
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "default" : "secondary"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    id: "id",
    enableHiding: false,
    cell: ({ row }) => {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <DotsHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                  id: Number(row.original.id),
                  type: DeleteType.EVENT_TAG,
                });
              }}
            >
              <div>Delete</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
