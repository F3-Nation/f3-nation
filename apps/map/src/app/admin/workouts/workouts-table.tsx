"use client";

import type { SortingState, TableOptions } from "@tanstack/react-table";
import { useState } from "react";
import { Check, Filter, X } from "lucide-react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import { IsActiveStatus } from "@acme/shared/app/enums";
import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@acme/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { MDTable, usePagination } from "@acme/ui/md-table";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { Cell, Header } from "@acme/ui/table";

import type { RouterOutputs } from "~/orpc/types";
import { orpc, useQuery } from "~/orpc/react";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { AOSFilter } from "../_components/ao-filter";
import { RegionFilter } from "../_components/region-filter";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const WorkoutsTable = () => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { pagination, setPagination } = usePagination();
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);
  const [selectedAos, setSelectedAos] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);
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
        onlyMine: onlyMine || undefined,
      },
    }),
  );

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
          <FilterComponent
            selectedStatuses={selectedStatuses}
            setSelectedStatuses={setSelectedStatuses}
            onlyMine={onlyMine}
            setOnlyMine={setOnlyMine}
          />
          <AOSFilter
            onAoSelect={(ao) => {
              const newAos = selectedAos.some((a) => a.id === ao.id)
                ? selectedAos.filter((a) => a.id !== ao.id)
                : [...selectedAos, ao];
              setSelectedAos(newAos);
            }}
            selectedAos={selectedAos}
          />
          <RegionFilter
            onRegionSelect={(region) => {
              const newRegions = selectedRegions.some((r) => r.id === region.id)
                ? selectedRegions.filter((r) => r.id !== region.id)
                : [...selectedRegions, region];
              setSelectedRegions(newRegions);
            }}
            selectedRegions={selectedRegions}
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
    accessorKey: "isPrivate",
    meta: { name: "Visibility" },
    header: Header,
    cell: ({ row }) => {
      return (
        <div className="flex items-center justify-start">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
              row.original.isPrivate
                ? "border-amber-200 bg-amber-100 text-amber-700"
                : "border-blue-200 bg-blue-100 text-blue-700"
            }`}
          >
            {row.original.isPrivate ? "Private" : "Public"}
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

const FilterComponent = ({
  selectedStatuses,
  setSelectedStatuses,
  onlyMine,
  setOnlyMine,
}: {
  selectedStatuses: IsActiveStatus[];
  setSelectedStatuses: (statuses: IsActiveStatus[]) => void;
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-row gap-2">
      {/* Status badges */}
      <div className="flex flex-wrap gap-1">
        {selectedStatuses.includes("active") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-green-100 px-2 py-1 text-green-700 hover:bg-green-200",
            )}
            onClick={() => {
              setSelectedStatuses(
                selectedStatuses.filter((s) => s !== "active"),
              );
            }}
          >
            Active
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {selectedStatuses.includes("inactive") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200",
            )}
            onClick={() => {
              setSelectedStatuses(
                selectedStatuses.filter((s) => s !== "inactive"),
              );
            }}
          >
            Inactive
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {onlyMine && (
          <Badge
            className="flex items-center gap-1 rounded-full border-transparent bg-blue-100 px-2 py-1 text-blue-700 hover:bg-blue-200"
            onClick={() => {
              setOnlyMine(false);
            }}
          >
            Only Mine
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-expanded={open}
            className="flex size-8 items-center justify-center rounded-full bg-muted shadow-md hover:bg-background/80"
          >
            <Filter className="size-5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {IsActiveStatus.map((status) => (
                <CommandItem
                  key={status}
                  value={status}
                  onSelect={() => {
                    const newStatuses = selectedStatuses.includes(status)
                      ? selectedStatuses.filter((s) => s !== status)
                      : [...selectedStatuses, status];
                    setSelectedStatuses(newStatuses);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedStatuses.includes(status)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() => {
                  setOnlyMine(!onlyMine);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    onlyMine ? "opacity-100" : "opacity-0",
                  )}
                />
                Only Mine
              </CommandItem>
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
