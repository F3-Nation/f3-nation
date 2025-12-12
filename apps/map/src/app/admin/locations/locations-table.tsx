"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import type { SortingSchema } from "@acme/validators";
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
import { RegionFilter } from "../_components/region-filter";
import { LocationIsActiveFilter } from "./location-is-active-table";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const LocationsTable = () => {
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);
  const { pagination, setPagination } = usePagination();
  const [searchTerm, setSearchTerm] = useState("");
  const [sorting, setSorting] = useState<SortingSchema>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const { data: locations } = useQuery(
    orpc.location.all.queryOptions({
      input: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        searchTerm: searchTerm,
        sorting: sorting,
        statuses: selectedStatuses,
        regionIds: selectedRegions.map((region) => region.id),
      },
    }),
  );

  const handleStatusSelect = (status: IsActiveStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  return (
    <MDTable
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      data={locations?.locations}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      totalCount={locations?.totalCount}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_LOCATIONS, { id: row.original.id });
      }}
      pagination={pagination}
      setPagination={setPagination}
      sorting={sorting}
      setSorting={setSorting}
      filterComponent={
        <>
          <RegionFilter
            onRegionSelect={(region) => {
              const newRegions = selectedRegions.includes(region)
                ? selectedRegions.filter((r) => r !== region)
                : [...selectedRegions, region];
              setSelectedRegions(newRegions);
            }}
            selectedRegions={selectedRegions}
          />
          <LocationIsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
          />
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["location"]["all"]["locations"][number]
>["columns"] = [
  {
    accessorKey: "locationName",
    meta: { name: "Location Name" },
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
    accessorKey: "latitude",
    meta: { name: "Latitude" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "longitude",
    meta: { name: "Longitude" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressStreet",
    meta: { name: "Street" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressStreet2",
    meta: { name: "Street 2" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressCity",
    meta: { name: "City" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressState",
    meta: { name: "State" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressZip",
    meta: { name: "Zip" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "addressCountry",
    meta: { name: "Country" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
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
                  type: DeleteType.LOCATION,
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
