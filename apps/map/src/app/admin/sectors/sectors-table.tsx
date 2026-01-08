"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { useState } from "react";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { MDTable, usePagination } from "@acme/ui/md-table";
import { Cell, Header } from "@acme/ui/table";

import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { StatusFilter } from "../_components/status-filter";
import { ResetFilter } from "../_components/reset-filter";

type Sector = RouterOutputs["org"]["all"]["orgs"][number];

export const SectorsTable = () => {
  const { pagination, setPagination } = usePagination();
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: sectorsData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["sector"],
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        statuses: selectedStatuses,
        onlyMine: onlyMine || undefined,
        searchTerm: searchTerm || undefined,
      },
    }),
  );

  const sectors = sectorsData?.orgs;

  return (
    <MDTable
      data={sectors}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_SECTORS, { id: row.original.id });
      }}
      totalCount={sectorsData?.total}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      filterComponent={
        <>
          <StatusFilter
            selectedStatuses={selectedStatuses}
            setSelectedStatuses={setSelectedStatuses}
            onlyMine={onlyMine}
            setOnlyMine={setOnlyMine}
            resetPage={() =>
              setPagination((prev) => ({ ...prev, pageIndex: 0 }))
            }
          />
          <ResetFilter
            onClick={() => {
              setSelectedStatuses(["active"]);
              setOnlyMine(true);
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
            }}
          />
        </>
      }
    />
  );
};

const columns: TableOptions<Sector>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Sector" },
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
    accessorKey: "aoCount",
    meta: { name: "AO Count" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
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
                  type: DeleteType.SECTOR,
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
