"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { client } from "~/orpc/client";
import type { RouterOutputs } from "~/orpc/types";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";
import { ResetFilter } from "../_components/reset-filter";
import { StatusFilter } from "../_components/status-filter";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);

  // Reference lists used to compute parentOrgIds below -- must be
  // exhaustive (not the default single-page org.all response), or a
  // sector/area outside the first page would silently drop out of
  // filtering.
  const { data: sectors } = useFetchAllPages({
    queryKey: ["org.all.everySector"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: ["sector"],
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });

  const { data: areas } = useFetchAllPages({
    queryKey: ["org.all.everyArea"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: ["area"],
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });

  // Compute parentOrgIds for filtering regions
  // If specific areas are selected, use those
  // If only sectors are selected, use all areas belonging to those sectors
  const parentOrgIds = useMemo(() => {
    if (selectedAreas.length > 0) {
      return selectedAreas.map((area) => area.id);
    }
    if (selectedSectors.length > 0 && areas) {
      const selectedSectorIds = selectedSectors.map((s) => s.id);
      return areas
        .filter(
          (area) => area.parentId && selectedSectorIds.includes(area.parentId),
        )
        .map((area) => area.id);
    }
    return [];
  }, [selectedAreas, selectedSectors, areas]);

  const { data: regionsData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["region"],
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        statuses: selectedStatuses,
        searchTerm: searchTerm || undefined,
        onlyMine: onlyMine || undefined,
        parentOrgIds: parentOrgIds.length > 0 ? parentOrgIds : undefined,
      },
    }),
  );

  const regions = regionsData?.orgs;

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
    return areas?.reduce<Record<number, Org>>((acc, area) => {
      acc[area.id] = area;
      return acc;
    }, {});
  }, [areas]);

  const idToSectorMap = useMemo(() => {
    return sectors?.reduce<Record<number, Org>>((acc, sector) => {
      acc[sector.id] = sector;
      return acc;
    }, {});
  }, [sectors]);

  const regionsWithNames = useMemo(() => {
    return regions?.map((region) => {
      const area = region.parentId ? idToAreaMap?.[region.parentId] : null;
      const sector = area?.parentId ? idToSectorMap?.[area.parentId] : null;
      return {
        ...region,
        sector: sector?.name,
        area: area?.name,
      };
    });
  }, [regions, idToAreaMap, idToSectorMap]);

  const handleSectorSelect = useCallback(
    (sector: Org) => {
      setSelectedSectors((prev) => {
        if (prev.includes(sector)) {
          return prev.filter((s) => s !== sector);
        }
        return [...prev, sector];
      });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [setPagination],
  );

  const handleAreaSelect = useCallback(
    (area: Org) => {
      setSelectedAreas((prev) => {
        if (prev.includes(area)) {
          return prev.filter((a) => a !== area);
        }
        return [...prev, area];
      });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [setPagination],
  );

  const handleResetFilters = useCallback(() => {
    setSelectedSectors([]);
    setSelectedAreas([]);
    setSelectedStatuses(["active"]);
    setOnlyMine(true);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [setPagination]);

  const activeFilterCount =
    selectedStatuses.length +
    selectedSectors.length +
    selectedAreas.length +
    (onlyMine ? 1 : 0);

  return (
    <MDTable
      data={regionsWithNames}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20, pageSizeOptions: [10, 20, 50, 100] }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_REGIONS, { id: row.original.id });
      }}
      totalCount={regionsData?.total}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      filterComponent={
        <>
          {/* Desktop: inline filters */}
          <div className="hidden items-center gap-2 md:flex">
            <StatusFilter
              selectedStatuses={selectedStatuses}
              setSelectedStatuses={setSelectedStatuses}
              onlyMine={onlyMine}
              setOnlyMine={setOnlyMine}
              resetPage={() =>
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }
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
            <ResetFilter onClick={handleResetFilters} />
          </div>
          {/* Mobile: sheet-based filters */}
          <MobileFilterSheet
            activeFilterCount={activeFilterCount}
            onReset={handleResetFilters}
          >
            <div>
              <p className="mb-1 text-sm font-medium">Status</p>
              <StatusFilter
                selectedStatuses={selectedStatuses}
                setSelectedStatuses={setSelectedStatuses}
                onlyMine={onlyMine}
                setOnlyMine={setOnlyMine}
                resetPage={() =>
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Sector</p>
              <SectorFilter
                onSectorSelect={handleSectorSelect}
                selectedSectors={selectedSectors}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Area</p>
              <AreaFilter
                selectedSectors={selectedSectors}
                onAreaSelect={handleAreaSelect}
                selectedAreas={selectedAreas}
              />
            </div>
          </MobileFilterSheet>
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
        : new Date(
            row.lastAnnualReview.substring(0, 10) + "T00:00:00",
          ).toLocaleDateString(),
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
      if (!row.original.isActive) return null;

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
              <div>Deactivate</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
