"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { Check, Filter, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { IsActiveStatus } from "@acme/shared/app/enums";
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

import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { AreaFilter } from "./area-filter";
import { SectorFilter } from "./sector-filter";

type Org = NonNullable<RouterOutputs["org"]["all"]>["orgs"][number];

export const RegionsTable = () => {
  const { pagination, setPagination } = usePagination();
  const [selectedSectors, setSelectedSectors] = useState<Org[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);

  const { data: regionsData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["region"],
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        statuses: selectedStatuses,
        onlyMine: onlyMine || undefined,
      },
    }),
  );

  const { data: sectorsData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["sector"],
      },
    }),
  );

  const { data: areasData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["area"],
      },
    }),
  );

  const regions = regionsData?.orgs;
  const sectors = sectorsData?.orgs;
  const areas = areasData?.orgs;

  // Filter selected areas when sectors change
  // Only depend on selectedSectors to avoid infinite loops
  // Access areas from closure - it's stable due to useMemo above
  useEffect(() => {
    if (!areas?.length) return;
    const selectedSectorsIds = selectedSectors.map((sector) => sector.id);
    setSelectedAreas((selectedAreas) =>
      selectedAreas.filter(
        (area) =>
          !selectedSectorsIds.length ||
          (!!area.parentId && selectedSectorsIds.includes(area.parentId)),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectors]); // Only depend on selectedSectors - areas is stable via useMemo

  const idToAreaMap = useMemo(() => {
    return areas?.reduce(
      (acc, area) => {
        acc[area.id] = area;
        return acc;
      },
      {} as Record<number, Org>,
    );
  }, [areas]);

  const idToSectorMap = useMemo(() => {
    return sectors?.reduce(
      (acc, sector) => {
        acc[sector.id] = sector;
        return acc;
      },
      {} as Record<number, Org>,
    );
  }, [sectors]);

  const filteredRegions = useMemo(() => {
    return regions
      ?.map((region) => {
        const area = region.parentId ? idToAreaMap?.[region.parentId] : null;
        const sector = area?.parentId ? idToSectorMap?.[area.parentId] : null;
        return {
          ...region,
          sector: sector?.name,
          area: area?.name,
        };
      })
      .filter((region) => {
        return (
          (!selectedSectors.length ||
            selectedSectors.some((s) => s.name === region.sector)) &&
          (!selectedAreas.length ||
            selectedAreas.some((a) => a.name === region.area))
        );
      });
  }, [regions, idToAreaMap, idToSectorMap, selectedSectors, selectedAreas]);

  const handleSectorSelect = useCallback((sector: Org) => {
    setSelectedSectors((prev) => {
      if (prev.includes(sector)) {
        return prev.filter((s) => s !== sector);
      }
      return [...prev, sector];
    });
  }, []);

  const handleAreaSelect = useCallback((area: Org) => {
    setSelectedAreas((prev) => {
      if (prev.includes(area)) {
        return prev.filter((a) => a !== area);
      }
      return [...prev, area];
    });
  }, []);

  return (
    <MDTable
      data={filteredRegions}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100] }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_REGIONS, { id: row.original.id });
      }}
      totalCount={regionsData?.total}
      pagination={pagination}
      setPagination={setPagination}
      filterComponent={
        <>
          <FilterComponent
            selectedStatuses={selectedStatuses}
            setSelectedStatuses={setSelectedStatuses}
            onlyMine={onlyMine}
            setOnlyMine={setOnlyMine}
          />
          <SectorFilter
            onSectorSelect={handleSectorSelect}
            selectedSectors={selectedSectors}
          />
          <AreaFilter
            selectedSectors={selectedSectors}
            onAreaSelect={handleAreaSelect}
            selectedAreas={selectedAreas}
          />
        </>
      }
      // rowClassName={(row) => {
      //   if (row.original.submitterValidated === true) {
      //     return "opacity-30";
      //   }
      // }}
    />
  );
};

const columns: TableOptions<
  RouterOutputs["org"]["all"]["orgs"][number]
>["columns"] = [
  {
    accessorKey: "name",
    meta: { name: "Region" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "area",
    meta: { name: "Area" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    accessorKey: "sector",
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
                  type: DeleteType.REGION,
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
