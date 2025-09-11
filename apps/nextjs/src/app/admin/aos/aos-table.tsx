"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import type { RouterOutputs } from "@acme/api";
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

import { IsActiveFilter } from "~/app/admin/_components/is-active-filter";
import { RegionFilter } from "~/app/admin/_components/region-filter";
import { api } from "~/trpc/react";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const AOsTable = () => {
  const { pagination, setPagination } = usePagination();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [sorting, setSorting] = useState<SortingSchema>([]);
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);

  const { data: aos } = api.org.all.useQuery({
    orgTypes: ["ao"],
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    searchTerm: searchTerm,
    sorting: sorting,
    parentOrgIds: selectedRegions.map((region) => region.id),
    statuses: selectedStatuses,
  });

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
      data={aos?.orgs}
      containerClassName="max-w-full"
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_AOS, { id: row.original.id });
      }}
      totalCount={aos?.total}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
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
          <IsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
          />
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["org"]["all"]["orgs"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Name" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "parentOrgName",
    meta: { name: "Region" },
    header: Header,
    cell: (cell) => (
      <Cell>
        {cell.row.original.parentOrgType === "region"
          ? cell.row.original.parentOrgName
          : ""}
      </Cell>
    ),
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
  // {
  //   accessorKey: "description",
  //   meta: { name: "Description" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "website",
  //   meta: { name: "Website" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "email",
  //   meta: { name: "Email" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "twitter",
  //   meta: { name: "Twitter" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "facebook",
  //   meta: { name: "Facebook" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  // {
  //   accessorKey: "instagram",
  //   meta: { name: "Instagram" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
  {
    accessorKey: "lastAnnualReview",
    accessorFn: (row) =>
      row.lastAnnualReview == null
        ? ""
        : new Date(row.lastAnnualReview).toLocaleDateString(),
    meta: { name: "Last Annual Review" },
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
                  type: DeleteType.AO,
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
