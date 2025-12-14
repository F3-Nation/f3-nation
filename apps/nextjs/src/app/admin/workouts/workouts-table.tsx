"use client";

import type { SortingState, TableOptions } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";
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
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { AOSFilter } from "../_components/ao-filter";
import { RegionFilter } from "../_components/region-filter";
import { WorkoutIsActiveFilter } from "./workout-is-active-table";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const WorkoutsTable = () => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { pagination, setPagination } = usePagination();
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);
  const [selectedAos, setSelectedAos] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const { data: workouts } = useQuery(
    orpc.event.all.queryOptions({
      input: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        searchTerm: searchTerm,
        sorting: sorting,
        statuses: selectedStatuses,
        regionIds: selectedRegions.map((region) => region.id),
        aoIds: selectedAos.map((ao) => ao.id),
      },
    }),
  );

  const handleStatusSelect = useCallback((status: IsActiveStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      } else {
        return [...prev, status];
      }
    });
  }, []);

  return (
    <MDTable
      data={workouts?.events}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_EVENTS, { id: row.original.id });
      }}
      totalCount={workouts?.totalCount}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      sorting={sorting}
      setSorting={setSorting}
      filterComponent={
        <>
          <AOSFilter
            onAoSelect={(ao) => {
              const newAos = selectedAos.includes(ao)
                ? selectedAos.filter((a) => a !== ao)
                : [...selectedAos, ao];
              setSelectedAos(newAos);
            }}
            selectedAos={selectedAos}
          />
          <RegionFilter
            onRegionSelect={(region) => {
              const newRegions = selectedRegions.includes(region)
                ? selectedRegions.filter((r) => r !== region)
                : [...selectedRegions, region];
              setSelectedRegions(newRegions);
            }}
            selectedRegions={selectedRegions}
          />
          <WorkoutIsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
          />
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["event"]["all"]["events"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Event Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "regions",
    meta: { name: "Regions" },
    header: Header,
    cell: (cell) => (
      <Cell {...cell}>
        {cell.row.original.regions
          .map((region) => region.regionName)
          .join(", ")}
      </Cell>
    ),
  },
  {
    accessorKey: "ao",
    meta: { name: "AO" },
    header: Header,
    cell: (cell) => (
      <Cell {...cell}>
        {/* {cell.row.original.parents.map((ao) => ao.aoName).join(", ")} */}
        {cell.row.original.parent}
      </Cell>
    ),
  },
  {
    accessorKey: "location",
    meta: { name: "Location" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "dayOfWeek",
    meta: { name: "Day of Week" },
    accessorFn: (row) => dayOfWeekToShortDayOfWeek(row.dayOfWeek ?? "sunday"),
    header: Header,
    cell: Cell,
  },
  {
    accessorKey: "isActive",
    meta: { name: "Status" },
    header: Header,
    cell: ({ row }) => {
      return (
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
      );
    },
  },
  {
    accessorKey: "created",
    accessorFn: (row) => new Date(row.created).toLocaleDateString(),
    meta: { name: "Created At" },
    header: Header,
    cell: Cell,
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
                  type: DeleteType.EVENT,
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
