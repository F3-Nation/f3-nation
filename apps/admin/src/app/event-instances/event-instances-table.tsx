"use client";

import type { SortingState, TableOptions } from "@tanstack/react-table";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { useState } from "react";

import type { IsActiveStatus } from "@acme/shared/app/enums";
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
import { AOSFilter } from "../_components/ao-filter";
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";
import { RegionFilter } from "../_components/region-filter";
import { ResetFilter } from "../_components/reset-filter";
import { EventTypeIsActiveFilter } from "../event-types/event-type-is-active-filter";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

function seriesExceptionLabel(value: string): string {
  switch (value) {
    case "closed":
      return "Closed";
    case "different-time":
      return "Different time";
    case "miscellaneous":
      return "Miscellaneous";
    default:
      return value;
  }
}

export const EventInstancesTable = () => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { pagination, setPagination } = usePagination({ pageSize: 20 });
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);
  const [selectedAos, setSelectedAos] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const { data: eventInstancesResult } = useQuery(
    orpc.eventInstance.all.queryOptions({
      input: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        searchTerm: debouncedSearchTerm,
        sorting: sorting,
        statuses: selectedStatuses,
        regionOrgIds:
          selectedRegions.length > 0
            ? selectedRegions.map((r) => r.id)
            : undefined,
        aoOrgIds:
          selectedAos.length > 0 ? selectedAos.map((a) => a.id) : undefined,
      },
    }),
  );

  const handleResetFilters = () => {
    setSelectedStatuses(["active"]);
    setSelectedAos([]);
    setSelectedRegions([]);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const activeFilterCount =
    selectedStatuses.length + selectedAos.length + selectedRegions.length;

  const handleAoSelect = (ao: Org) => {
    const newAos = selectedAos.some((a) => a.id === ao.id)
      ? selectedAos.filter((a) => a.id !== ao.id)
      : [...selectedAos, ao];
    setSelectedAos(newAos);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleRegionSelect = (region: Org) => {
    const newRegions = selectedRegions.some((r) => r.id === region.id)
      ? selectedRegions.filter((r) => r.id !== region.id)
      : [...selectedRegions, region];
    setSelectedRegions(newRegions);
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

  return (
    <MDTable
      data={eventInstancesResult?.eventInstances}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_EVENT_INSTANCES, { id: row.original.id });
      }}
      totalCount={eventInstancesResult?.totalCount}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      sorting={sorting}
      setSorting={setSorting}
      filterComponent={
        <>
          <div className="hidden items-center gap-2 md:flex">
            <EventTypeIsActiveFilter
              onStatusSelect={handleStatusSelect}
              selectedStatuses={selectedStatuses}
            />
            <AOSFilter onAoSelect={handleAoSelect} selectedAos={selectedAos} />
            <RegionFilter
              onRegionSelect={handleRegionSelect}
              selectedRegions={selectedRegions}
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
              <p className="mb-1 text-sm font-medium">AO</p>
              <AOSFilter
                onAoSelect={handleAoSelect}
                selectedAos={selectedAos}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Region</p>
              <RegionFilter
                onRegionSelect={handleRegionSelect}
                selectedRegions={selectedRegions}
              />
            </div>
          </MobileFilterSheet>
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["eventInstance"]["all"]["eventInstances"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "startDate",
    meta: { name: "Start date" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "endDate",
    meta: { name: "End date" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "startTime",
    meta: { name: "Start" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "endTime",
    meta: { name: "End" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "aoName",
    meta: { name: "AO" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "regionName",
    meta: { name: "Region" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "seriesException",
    meta: { name: "Series exception" },
    header: Header,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.seriesException != null
          ? seriesExceptionLabel(row.original.seriesException)
          : "—"}
      </span>
    ),
  },
  {
    accessorKey: "isPrivate",
    meta: { name: "Visibility" },
    header: Header,
    cell: ({ row }) => (
      <Badge variant={row.original.isPrivate ? "secondary" : "outline"}>
        {row.original.isPrivate ? "Private" : "Public"}
      </Badge>
    ),
  },
  {
    accessorKey: "isActive",
    meta: { name: "Status" },
    header: Header,
    cell: ({ row }) => (
      <div className="flex items-center justify-start">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
            row.original.isActive
              ? "border-green-200 bg-green-100 text-green-700"
              : "border-red-200 bg-red-100 text-red-700"
          }`}
        >
          {row.original.isActive ? "Active" : "Inactive"}
        </span>
      </div>
    ),
  },
  {
    id: "id",
    enableHiding: false,
    cell: ({ row }) => {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
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
                  type: DeleteType.EVENT_INSTANCE,
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
