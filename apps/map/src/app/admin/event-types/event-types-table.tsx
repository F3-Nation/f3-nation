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
import { useDebounce } from "~/utils/hooks/use-debounce";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { EventTypeIsActiveFilter } from "./event-type-is-active-filter";
import { OrgFilter } from "./org-filter";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const EventTypesTable = () => {
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

  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        orgIds: selectedOrgs.map((org) => org.id),
        statuses: selectedStatuses,
        searchTerm: debouncedSearchTerm,
        pageSize: pagination.pageSize,
        pageIndex: pagination.pageIndex,
        ignoreNationEventTypes: true,
        sorting: sorting,
      },
    }),
  );

  const handleOrgSelect = (org: Org) => {
    setSelectedOrgs((prev) => {
      if (prev.includes(org)) {
        return prev.filter((s) => s !== org);
      } else {
        return [...prev, org];
      }
    });
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleStatusSelect = (status: IsActiveStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      } else {
        return [...prev, status];
      }
    });
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  return (
    <MDTable
      data={eventTypes?.eventTypes}
      totalCount={eventTypes?.totalCount}
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
        openModal(ModalType.ADMIN_EVENT_TYPES, { id: row.original.id });
      }}
      filterComponent={
        <>
          <EventTypeIsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
          />
          <OrgFilter
            onOrgSelect={handleOrgSelect}
            selectedOrgs={selectedOrgs}
          />
        </>
      }
    />
  );
};

const columns: TableOptions<
  RouterOutputs["eventType"]["all"]["eventTypes"][number]
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
    accessorKey: "eventCategory",
    meta: { name: "Event Category" },
    header: Header,
    cell: (cell) => {
      const ec = cell.row.original.eventCategory;
      const roleStyles = {
        first_f: "bg-purple-100 text-purple-700 border-purple-200",
        second_f: "bg-blue-100 text-blue-700 border-blue-200",
        third_f: "bg-green-100 text-green-700 border-green-200",
      } as const;

      const roleLabels = {
        first_f: "1st F",
        second_f: "2nd F",
        third_f: "3rd F",
      } as const;

      return (
        <div className="flex flex-wrap items-center justify-start">
          <span
            className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${roleStyles[ec]}`}
          >
            {roleLabels[ec]}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "specificOrgName",
    accessorFn: (row) => row.specificOrgName,
    meta: { name: "Specific Org" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "count",
    meta: { name: "Count" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
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
                  type: DeleteType.EVENT_TYPE,
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
