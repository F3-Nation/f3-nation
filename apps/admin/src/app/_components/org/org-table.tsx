"use client";

import { useMemo, useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { CellContext, TableOptions } from "@tanstack/react-table";
import type { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
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
import { MobileFilterSheet } from "../mobile-filter-sheet";
import { ResetFilter } from "../reset-filter";
import { StatusFilter } from "../status-filter";
import { RegionFilter } from "../region-filter";
import { AreaFilter } from "./area-filter";
import { SectorFilter } from "./sector-filter";
import { orgAdminConfig } from "./org-admin-config";
import { findAncestorByType } from "./org-ancestry";
import { useOrgFilters } from "./use-org-filters";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

function orgColumns(orgType: OrgType): TableOptions<Org>["columns"] {
  const config = orgAdminConfig[orgType];
  return [
    {
      accessorKey: "name",
      meta: { name: config.nameColumn ?? orgTypeDisplay[orgType].label },
      header: Header,
      cell: Cell,
    },
    ...config.columns.map((column) => ({
      accessorKey: column.key,
      ...(column.id ? { id: column.id } : {}),
      meta: { name: column.label },
      header: Header,
      cell: column.parentType
        ? (cell: CellContext<Org, unknown>) => (
            <Cell>
              {cell.row.original.parentOrgType === column.parentType
                ? cell.row.original.parentOrgName
                : ""}
            </Cell>
          )
        : Cell,
    })),
    {
      id: config.statusId,
      accessorKey: "isActive",
      meta: { name: "Status" },
      header: Header,
      cell: ({ row }) => (
        <div className="flex items-center justify-start">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${row.original.isActive ? "border-green-200 bg-green-100 text-green-700" : "border-red-200 bg-red-100 text-red-700"}`}
          >
            {row.original.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      ),
    },
    ...(config.aoCount
      ? [
          {
            accessorKey: "aoCount",
            meta: { name: "AO Count" },
            header: Header,
            cell: Cell,
          },
        ]
      : []),
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
      cell: Cell,
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
      ...(!config.actionSorting ? { enableSorting: false } : {}),
      cell: ({ row }) => {
        if (!config.inactiveAction && !row.original.isActive) return null;
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
                onClick={(event) => {
                  event.stopPropagation();
                  openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                    id: Number(row.original.id),
                    type: DeleteType.ORG,
                    orgType,
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
}

export function OrgTable({ orgType }: { orgType: OrgType }) {
  const config = orgAdminConfig[orgType];
  const { pagination, setPagination } = usePagination();
  const [searchTerm, setSearchTerm] = useState("");
  const [sorting, setSorting] = useState<SortingSchema>([]);
  const resetPage = () => setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  const filters = useOrgFilters(config, resetPage);
  const { data } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: [orgType],
        ...(config.serverPagination
          ? {
              pageIndex: pagination.pageIndex,
              pageSize: pagination.pageSize,
              statuses: filters.selectedStatuses,
              onlyMine: filters.onlyMine || undefined,
              searchTerm: searchTerm || config.emptySearch,
              ...(config.filters !== "status"
                ? { parentOrgIds: filters.parentOrgIds }
                : {}),
              ...(config.serverSorting ? { sorting } : {}),
            }
          : {}),
      },
    }),
  );
  const rows = useMemo(
    () =>
      data?.orgs.map((org) => {
        if (!config.displayAncestors) return org;
        const names: Record<string, string | undefined> = {};
        let ancestor: Org | undefined = org;
        for (const type of config.displayAncestors) {
          ancestor = ancestor
            ? findAncestorByType(ancestor, type, filters.orgById)
            : undefined;
          names[type] = ancestor?.name;
        }
        return { ...org, ...names };
      }),
    [data, config, filters.orgById],
  );
  const columns = useMemo(() => orgColumns(orgType), [orgType]);
  const status = (
    <StatusFilter
      selectedStatuses={filters.selectedStatuses}
      setSelectedStatuses={filters.setSelectedStatuses}
      onlyMine={filters.onlyMine}
      setOnlyMine={filters.setOnlyMine}
      resetPage={resetPage}
    />
  );
  const extraFilters = [
    ...(config.filters === "sector" || config.filters === "sectorArea"
      ? [
          {
            label: "Sector",
            control: (
              <SectorFilter
                onSectorSelect={filters.handleSectorSelect}
                selectedSectors={filters.selectedSectors}
                sectors={filters.sectors}
              />
            ),
          },
        ]
      : []),
    ...(config.filters === "sectorArea"
      ? [
          {
            label: "Area",
            control: (
              <AreaFilter
                onAreaSelect={filters.handleAreaSelect}
                selectedAreas={filters.selectedAreas}
                areas={filters.availableAreas}
              />
            ),
          },
        ]
      : []),
    ...(config.filters === "region"
      ? [
          {
            label: "Region",
            control: (
              <RegionFilter
                onRegionSelect={filters.handleRegionSelect}
                selectedRegions={filters.selectedRegions}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <MDTable
      data={rows}
      cellClassName="p-1"
      containerClassName={config.containerClassName}
      paginationOptions={{
        pageSize: 20,
        ...(config.pageSizeOptions
          ? { pageSizeOptions: config.pageSizeOptions }
          : {}),
      }}
      columns={columns}
      onRowClick={(row) =>
        openModal(ModalType.ADMIN_ORG, { orgType, id: row.original.id })
      }
      {...(config.serverPagination
        ? {
            totalCount: data?.total,
            pagination,
            setPagination,
            searchTerm,
            setSearchTerm,
          }
        : {})}
      {...(config.serverSorting ? { sorting, setSorting } : {})}
      filterComponent={
        config.filters === "none" ? undefined : (
          <>
            <div className="hidden items-center gap-2 md:flex">
              {status}
              {extraFilters.map(({ label, control }) => (
                <span key={label} className="contents">
                  {control}
                </span>
              ))}
              <ResetFilter onClick={filters.reset} />
            </div>
            <MobileFilterSheet
              activeFilterCount={filters.activeFilterCount}
              onReset={filters.reset}
            >
              <div>
                <p className="mb-1 text-sm font-medium">Status</p>
                {status}
              </div>
              {extraFilters.map(({ label, control }) => (
                <div key={label}>
                  <p className="mb-1 text-sm font-medium">{label}</p>
                  {control}
                </div>
              ))}
            </MobileFilterSheet>
          </>
        )
      }
    />
  );
}
