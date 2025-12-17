"use client";

import type { TableOptions, Updater } from "@tanstack/react-table";
import { useState } from "react";
import dayjs from "dayjs";
import { Check, Filter, X } from "lucide-react";

import { UpdateRequestStatus } from "@acme/shared/app/enums";
import { getFullAddress, requestTypeToTitle } from "@acme/shared/app/functions";
import { ZustandStore } from "@acme/shared/common/classes";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@acme/ui/command";
import { MDTable } from "@acme/ui/md-table";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { Cell, Header } from "@acme/ui/table";
import { toast } from "@acme/ui/toast";

import type { RouterOutputs } from "~/orpc/types";
import { orpc, useQuery } from "~/orpc/react";
import { vanillaApi } from "~/trpc/vanilla";
import { openRequestModal } from "~/utils/open-request-modal";

const initialState = {
  searchTerm: "",
  onlyMine: true,
  statuses: ["pending"] as UpdateRequestStatus[],
  sorting: [{ id: "created", desc: true }],
  pagination: {
    pageIndex: 0,
    pageSize: 20,
  },
};

type RequestTableStore = typeof initialState;

const requestTableStore = new ZustandStore({
  initialState,
  persistOptions: {
    name: "request-table-store",
    version: 1,
    persistedKeys: [],
    getStorage: () => localStorage,
  },
});

export const RequestsTable = () => {
  const searchTerm = requestTableStore.use.searchTerm();
  const onlyMine = requestTableStore.use.onlyMine();
  const sorting = requestTableStore.use.sorting();
  const pagination = requestTableStore.use.pagination();
  const statuses = requestTableStore.use.statuses();

  const { data: requests } = useQuery(
    orpc.request.all.queryOptions({
      input: {
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        searchTerm: searchTerm,
        sorting: sorting,
        onlyMine,
        statuses,
      },
    }),
  );

  const setValue =
    <T extends keyof RequestTableStore>(key: T) =>
    (value: Updater<RequestTableStore[T]>) => {
      const newValue =
        typeof value === "function"
          ? value(requestTableStore.getState()[key])
          : value;
      requestTableStore.setState({ [key]: newValue });
    };

  return (
    <MDTable
      data={requests?.requests}
      emptyMessage="No requests for these filters"
      rowsName="requests"
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      totalCount={requests?.totalCount}
      columns={columns}
      onRowClick={async (row) => {
        const request = await vanillaApi.request.byId({ id: row.original.id });
        if (!request) {
          toast.error("Request not found");
          return;
        }
        void openRequestModal({
          type: row.original.requestType,
          review: { request },
        });
      }}
      rowClassName={(row) =>
        `${row.original.status !== "pending" ? "opacity-30" : ""} ${
          row.original.requestType === "delete_event" ? "bg-red-100" : ""
        }`
      }
      searchTerm={searchTerm}
      setSearchTerm={setValue("searchTerm")}
      pagination={pagination}
      setPagination={setValue("pagination")}
      sorting={sorting}
      setSorting={setValue("sorting")}
      filterComponent={<FilterComponent />}
    />
  );
};

const columns: TableOptions<
  RouterOutputs["request"]["all"]["requests"][number]
>["columns"] = [
  {
    accessorKey: "status",
    meta: { name: "Status" },
    header: Header,
    cell: ({ row }) => {
      return (
        <div className="flex items-center justify-start gap-1">
          <span
            className={cn(
              `inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium`,
              {
                "border-green-200 bg-green-100 text-green-700":
                  row.original.status === "approved",
                "border-red-200 bg-red-100 text-red-700":
                  row.original.status === "rejected",
                "border-yellow-200 bg-yellow-100 text-yellow-700":
                  row.original.status === "pending",
              },
            )}
          >
            {row.original.status}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "requestType",
    meta: { name: "Request Type" },
    header: Header,
    cell: ({ row }) => {
      const title = requestTypeToTitle(row.original.requestType);
      return (
        <div className="flex items-center justify-start gap-1">
          <p>{title}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "regionName",
    meta: { name: "Region" },
    header: Header,
    cell: ({ row }) => {
      const isAnUpdate =
        row.original.oldRegionName !== row.original.newRegionName &&
        row.original.status === "pending";
      return (
        <div className="flex items-center justify-start gap-1">
          <div className="flex flex-col gap-1">
            <p>{row.original.newRegionName}</p>
            {isAnUpdate ? (
              <p className="line-through">{row.original.oldRegionName}</p>
            ) : null}
          </div>
          {isAnUpdate ? <CircleBadge /> : null}
        </div>
      );
    },
  },
  {
    accessorKey: "aoName",
    meta: { name: "Location / AO Name" },
    header: Header,
    cell: ({ row }) => {
      const isAnUpdate =
        row.original.oldAoName !== row.original.newAoName &&
        row.original.status === "pending";
      return (
        <div className="flex items-center justify-start gap-1">
          <div className="flex flex-col gap-1">
            <p>{row.original.newAoName}</p>
            {isAnUpdate ? (
              <p className="line-through">{row.original.oldAoName}</p>
            ) : null}
          </div>
          {isAnUpdate ? <CircleBadge /> : null}
        </div>
      );
    },
  },
  {
    accessorKey: "workoutName",
    meta: { name: "Workout" },
    header: Header,
    cell: ({ row }) => {
      const isAnUpdate =
        row.original.oldWorkoutName !== row.original.newWorkoutName &&
        row.original.status === "pending";
      return (
        <div className="flex items-center justify-start gap-1">
          <div className="flex flex-col gap-1">
            <p>{row.original.newWorkoutName}</p>
            {isAnUpdate ? (
              <p className="line-through">{row.original.oldWorkoutName}</p>
            ) : null}
          </div>
          {isAnUpdate ? <CircleBadge /> : null}
        </div>
      );
    },
  },
  {
    accessorKey: "location",
    meta: { name: "Location" },
    header: Header,
    cell: ({ row }) => {

      const newLocation = getFullAddress({
        locationAddress: row.original.newLocationAddress,
        locationAddress2: row.original.newLocationAddress2,
        locationCity: row.original.newLocationCity,
        locationState: row.original.newLocationState,
        locationCountry: row.original.newLocationCountry,
      });

      const oldLocation = getFullAddress({
        locationAddress: row.original.oldLocationAddress,
        locationAddress2: row.original.oldLocationAddress2,
        locationCity: row.original.oldLocationCity,
        locationState: row.original.oldLocationState,
        locationCountry: row.original.oldLocationCountry,
      });

      const isAnUpdate =
        oldLocation !== newLocation && row.original.status === "pending";

      return (
        <div className="flex items-center justify-start gap-1">
          <div className="flex flex-col gap-1">
            <p>{newLocation}</p>
            {isAnUpdate ? <p className="line-through">{oldLocation}</p> : null}
          </div>
          {isAnUpdate ? <CircleBadge /> : null}
        </div>
      );
    },
  },
  {
    accessorKey: "submittedBy",
    meta: { name: "Submitted By" },
    header: Header,
    cell: ({ row }) => {
      return (
        <div className="flex items-center justify-start gap-1">
          <span>{row.original.submittedBy}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "created",
    accessorFn: (row) => dayjs(row.created).format("M/D/YY h:mm A"),
    meta: { name: "Created At" },
    header: Header,
    cell: Cell,
  },
];

const CircleBadge = () => {
  return (
    <div className="flex items-center justify-start">
      <div className="size-3 rounded-full bg-red-500" />
    </div>
  );
};

const FilterComponent = () => {
  return (
    <div className="flex gap-2">
      <StatusFilter />
    </div>
  );
};

const StatusFilter = () => {
  const [open, setOpen] = useState(false);
  const statuses = requestTableStore.use.statuses();
  const onlyMine = requestTableStore.use.onlyMine();

  return (
    <div className="flex flex-row gap-2">
      {/* Status dropdown trigger */}
      <div className="flex flex-wrap gap-1">
        {statuses.includes("pending") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-yellow-100 px-2 py-1 text-yellow-700 hover:bg-yellow-200",
            )}
            onClick={() => {
              requestTableStore.setState({
                statuses: statuses.filter((s) => s !== "pending"),
              });
            }}
          >
            Pending
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {statuses.includes("rejected") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200",
            )}
            onClick={() => {
              requestTableStore.setState({
                statuses: statuses.filter((s) => s !== "rejected"),
              });
            }}
          >
            Rejected
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {statuses.includes("approved") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-green-100 px-2 py-1 text-green-700 hover:bg-green-200",
            )}
            onClick={() => {
              requestTableStore.setState({
                statuses: statuses.filter((s) => s !== "approved"),
              });
            }}
          >
            Approved
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {onlyMine && (
          <Badge
            className="flex items-center gap-1 rounded-full border-transparent bg-blue-100 px-2 py-1 text-blue-700 hover:bg-blue-200"
            onClick={() => {
              requestTableStore.setState({ onlyMine: !onlyMine });
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
              {UpdateRequestStatus.map((status) => (
                <CommandItem
                  key={status}
                  value={status}
                  onSelect={() => {
                    const newStatuses = statuses.includes(status)
                      ? statuses.filter((s) => s !== status)
                      : [...statuses, status];
                    requestTableStore.setState({ statuses: newStatuses });
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      statuses.includes(status) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() => {
                  requestTableStore.setState({ onlyMine: !onlyMine });
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
