"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useMemo, useReducer, useState } from "react";

import { IsActiveStatus } from "@acme/shared/app/enums";
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
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";
import { ResetFilter } from "../_components/reset-filter";
import { StatusFilter } from "../_components/status-filter";
import { AreaFilter } from "./area-filter";
import {
  AdminHierarchyOrgTypes,
  findAncestorByType,
  getOrgById,
  getParentOrgIdsForFilter,
  isDescendantOfAny,
  isOrgSelected,
} from "./org-ancestry";
import { SectorFilter } from "./sector-filter";

type Org = NonNullable<RouterOutputs["org"]["all"]>["orgs"][number];

interface OrgFilterState {
  selectedAreas: Org[];
  selectedSectors: Org[];
}

type OrgFilterAction =
  | {
      type: "toggle-sector";
      sector: Org;
      orgById: ReadonlyMap<number, Org>;
    }
  | { type: "toggle-area"; area: Org }
  | { type: "reset" };

const initialOrgFilterState: OrgFilterState = {
  selectedAreas: [],
  selectedSectors: [],
};

const orgFilterReducer = (
  state: OrgFilterState,
  action: OrgFilterAction,
): OrgFilterState => {
  if (action.type === "reset") return initialOrgFilterState;

  if (action.type === "toggle-area") {
    const isSelected = isOrgSelected(state.selectedAreas, action.area);
    return {
      ...state,
      selectedAreas: isSelected
        ? state.selectedAreas.filter((area) => area.id !== action.area.id)
        : [...state.selectedAreas, action.area],
    };
  }

  const isSelected = isOrgSelected(state.selectedSectors, action.sector);
  const selectedSectors = isSelected
    ? state.selectedSectors.filter((sector) => sector.id !== action.sector.id)
    : [...state.selectedSectors, action.sector];
  const selectedSectorIds = new Set(selectedSectors.map((sector) => sector.id));

  return {
    selectedSectors,
    selectedAreas:
      selectedSectorIds.size === 0
        ? state.selectedAreas
        : state.selectedAreas.filter((area) =>
            isDescendantOfAny(area, selectedSectorIds, action.orgById),
          ),
  };
};

export const RegionsTable = () => {
  const { pagination, setPagination } = usePagination();
  const [{ selectedAreas, selectedSectors }, dispatchOrgFilter] = useReducer(
    orgFilterReducer,
    initialOrgFilterState,
  );
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);

  const { data: hierarchyData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        // This must remain complete: a truncated hierarchy can make valid
        // descendants disappear. Fetch only areas and their possible ancestors.
        orgTypes: AdminHierarchyOrgTypes,
        statuses: IsActiveStatus,
      },
    }),
  );

  const hierarchyOrgs = hierarchyData?.orgs;
  const sectors = useMemo(
    () =>
      hierarchyOrgs?.filter((org) => org.orgType === "sector" && org.isActive),
    [hierarchyOrgs],
  );
  const areas = useMemo(
    () =>
      hierarchyOrgs?.filter((org) => org.orgType === "area" && org.isActive),
    [hierarchyOrgs],
  );
  const orgById = useMemo(
    () => getOrgById(hierarchyOrgs ?? []),
    [hierarchyOrgs],
  );
  const selectedSectorIds = useMemo(
    () => new Set(selectedSectors.map((sector) => sector.id)),
    [selectedSectors],
  );
  const availableAreas = useMemo(() => {
    if (selectedSectorIds.size === 0) return areas;
    return areas?.filter((area) =>
      isDescendantOfAny(area, selectedSectorIds, orgById),
    );
  }, [areas, orgById, selectedSectorIds]);

  // Compute parentOrgIds for filtering regions
  // If specific areas are selected, use those
  // Otherwise, use every area descended from the selected sectors
  const parentOrgIds = useMemo(() => {
    return getParentOrgIdsForFilter(
      selectedAreas.map((area) => area.id),
      selectedSectors.length > 0,
      availableAreas?.map((area) => area.id),
    );
  }, [availableAreas, selectedAreas, selectedSectors]);

  const { data: regionsData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["region"],
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        statuses: selectedStatuses,
        searchTerm: searchTerm || undefined,
        onlyMine: onlyMine || undefined,
        parentOrgIds,
      },
    }),
  );

  const regions = regionsData?.orgs;

  const regionsWithNames = useMemo(() => {
    return regions?.map((region) => {
      // Resolve display names through the full ancestor chain rather than the
      // active-area list: a region under a deactivated area still has one.
      const area = findAncestorByType(region, "area", orgById);
      const sector = area
        ? findAncestorByType(area, "sector", orgById)
        : undefined;
      return {
        ...region,
        sector: sector?.name,
        area: area?.name,
      };
    });
  }, [regions, orgById]);

  const handleSectorSelect = useCallback(
    (sector: Org) => {
      dispatchOrgFilter({ type: "toggle-sector", sector, orgById });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [orgById, setPagination],
  );

  const handleAreaSelect = useCallback(
    (area: Org) => {
      dispatchOrgFilter({ type: "toggle-area", area });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [setPagination],
  );

  const handleResetFilters = useCallback(() => {
    dispatchOrgFilter({ type: "reset" });
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
              sectors={sectors}
            />
            <AreaFilter
              onAreaSelect={handleAreaSelect}
              selectedAreas={selectedAreas}
              areas={availableAreas}
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
                sectors={sectors}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Area</p>
              <AreaFilter
                onAreaSelect={handleAreaSelect}
                selectedAreas={selectedAreas}
                areas={availableAreas}
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
