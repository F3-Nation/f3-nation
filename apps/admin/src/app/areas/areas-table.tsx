"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

import { IsActiveStatus } from "@acme/shared/app/enums";
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

import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";
import { ResetFilter } from "../_components/reset-filter";
import { StatusFilter } from "../_components/status-filter";
import {
  AdminAreaAncestorOrgTypes,
  findAncestorByType,
  getOrgById,
  getParentOrgIdsForFilter,
  isDescendantOfAny,
  isOrgSelected,
} from "../regions/org-ancestry";
import { SectorFilter } from "../regions/sector-filter";

type Org = NonNullable<RouterOutputs["org"]["all"]>["orgs"][number];

export const AreasTable = () => {
  const { pagination, setPagination } = usePagination();
  const [selectedSectors, setSelectedSectors] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sorting, setSorting] = useState<SortingSchema>([]);

  const { data: hierarchyData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        // This must remain complete: a truncated hierarchy can make valid
        // descendants disappear. Fetch only possible ancestors of an area.
        orgTypes: AdminAreaAncestorOrgTypes,
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
  const orgById = useMemo(
    () => getOrgById(hierarchyOrgs ?? []),
    [hierarchyOrgs],
  );

  // Compute parentOrgIds for filtering areas by selected sectors
  const parentOrgIds = useMemo(() => {
    const selectedSectorIds = new Set(
      selectedSectors.map((sector) => sector.id),
    );
    const matchingParentIds = hierarchyOrgs
      ?.filter(
        (org) =>
          selectedSectorIds.has(org.id) ||
          isDescendantOfAny(org, selectedSectorIds, orgById),
      )
      .map((org) => org.id);

    return getParentOrgIdsForFilter(
      [],
      selectedSectors.length > 0,
      matchingParentIds,
    );
  }, [hierarchyOrgs, orgById, selectedSectors]);

  const { data: areasData } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["area"],
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        statuses: selectedStatuses,
        onlyMine: onlyMine || undefined,
        searchTerm: searchTerm || undefined,
        parentOrgIds,
        sorting,
      },
    }),
  );

  const areas = areasData?.orgs;

  const areasWithSectorNames = useMemo(() => {
    return areas?.map((area) => {
      const sector = findAncestorByType(area, "sector", orgById);
      return {
        ...area,
        sector: sector?.name,
      };
    });
  }, [areas, orgById]);

  const handleSectorSelect = useCallback(
    (sector: Org) => {
      setSelectedSectors((prev) => {
        if (isOrgSelected(prev, sector)) {
          return prev.filter(
            (selectedSector) => selectedSector.id !== sector.id,
          );
        }
        return [...prev, sector];
      });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [setPagination],
  );

  const handleResetFilters = useCallback(() => {
    setSelectedSectors([]);
    setSelectedStatuses(["active"]);
    setOnlyMine(true);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [setPagination]);

  const activeFilterCount =
    selectedStatuses.length + selectedSectors.length + (onlyMine ? 1 : 0);

  return (
    <MDTable
      data={areasWithSectorNames}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_AREAS, { id: row.original.id });
      }}
      totalCount={areasData?.total}
      pagination={pagination}
      setPagination={setPagination}
      sorting={sorting}
      setSorting={setSorting}
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
    meta: { name: "Area" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    id: "parentOrgName",
    accessorKey: "sector",
    meta: { name: "Sector" },
    header: Header,
    cell: (cell) => <Cell {...cell} />,
  },
  {
    id: "status",
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
  //   accessorKey: "website",
  //   meta: { name: "Website" },
  //   header: Header,
  //   cell: (cell) => <Cell {...cell} />,
  // },
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
    enableSorting: false,
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
                  type: DeleteType.AREA,
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
