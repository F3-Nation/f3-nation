"use client";

import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import type { TableOptions } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { Button } from "@acme/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
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
import { useAuth } from "~/utils/hooks/use-auth";
import { useDebounce } from "~/utils/hooks/use-debounce";
import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { StatusFilter } from "../_components/status-filter";
import { ResetFilter } from "../_components/reset-filter";
import { MobileFilterSheet } from "../_components/mobile-filter-sheet";

type Position = RouterOutputs["position"]["all"]["positions"][number];

const ORG_LEVEL_OPTIONS = [
  { label: "All Levels", value: "" },
  ...OrgType.map((orgType) => ({
    label: orgTypeDisplay[orgType].label,
    value: orgType,
  })),
] as const;

type OrgLevel = "" | OrgType;

export const PositionsTable = () => {
  const { isNationAdmin } = useAuth();
  const { pagination, setPagination } = usePagination({ pageSize: 20 });
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [selectedOrgLevel, setSelectedOrgLevel] = useState<OrgLevel>("");
  const [onlyMine, setOnlyMine] = useState(false);

  const isActiveFilter =
    selectedStatuses.length === 1
      ? selectedStatuses[0] === "active"
      : undefined;

  const { data } = useQuery(
    orpc.position.all.queryOptions({
      input: {
        isActive: isActiveFilter,
        orgType: selectedOrgLevel || undefined,
        statuses: selectedStatuses,
        onlyMine: onlyMine || undefined,
        searchTerm: debouncedSearchTerm || undefined,
        pageSize: pagination.pageSize,
        pageIndex: pagination.pageIndex,
      },
    }),
  );
  const { data: accessibleOrgs } = useQuery(orpc.org.accessible.queryOptions());
  const editableOrgIds = useMemo(
    () => new Set(accessibleOrgs?.orgs.map((org) => org.id) ?? []),
    [accessibleOrgs?.orgs],
  );

  const handleResetFilters = () => {
    setSelectedStatuses(["active"]);
    setOnlyMine(false);
    setSelectedOrgLevel("");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const activeFilterCount =
    selectedStatuses.length + (selectedOrgLevel ? 1 : 0) + (onlyMine ? 1 : 0);

  const getColumns = (): TableOptions<Position>["columns"] => [
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
      accessorKey: "orgName",
      meta: { name: "Scope" },
      header: Header,
      cell: ({ row }) => {
        const isNational = row.original.orgId === null;
        return (
          <div className="flex items-center justify-start">
            {isNational ? (
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-1.5 py-0 text-[10px] font-medium text-blue-700">
                National
              </span>
            ) : (
              <span>{row.original.orgName}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "orgType",
      meta: { name: "Org Level" },
      header: Header,
      cell: ({ row }) => {
        const orgType = row.original.orgType;
        return <Cell>{orgType ? orgTypeDisplay[orgType].label : "All"}</Cell>;
      },
    },
    {
      accessorKey: "isActive",
      meta: { name: "Status" },
      header: Header,
      cell: ({ row }) => (
        <div className="flex items-center justify-start">
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${
              row.original.isActive
                ? "border-green-200 bg-green-100 text-green-700"
                : "border-red-200 bg-red-100 text-red-700"
            }`}
          >
            {row.original.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        if (!row.original.isActive) return null;

        const isNational = row.original.orgId === null;
        const canEdit =
          isNationAdmin ||
          (!isNational &&
            row.original.orgId != null &&
            editableOrgIds.has(row.original.orgId));

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
                  openModal(ModalType.ADMIN_POSITIONS, {
                    id: row.original.id,
                  });
                }}
              >
                <div>{canEdit ? "Edit" : "View"}</div>
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                      id: Number(row.original.id),
                      type: DeleteType.POSITION,
                    });
                  }}
                >
                  <div>Deactivate</div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <MDTable
      data={data?.positions}
      containerClassName="max-w-full"
      cellClassName="p-1"
      columns={getColumns()}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_POSITIONS, { id: row.original.id });
      }}
      totalCount={data?.totalCount}
      pagination={pagination}
      setPagination={setPagination}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      filterComponent={
        <>
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
            <OrgLevelFilter
              value={selectedOrgLevel}
              onChange={(v) => {
                setSelectedOrgLevel(v);
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
            />
            <ResetFilter onClick={handleResetFilters} />
          </div>
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
              <p className="mb-1 text-sm font-medium">Org Level</p>
              <OrgLevelFilter
                value={selectedOrgLevel}
                onChange={(v) => {
                  setSelectedOrgLevel(v);
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                }}
              />
            </div>
          </MobileFilterSheet>
        </>
      }
    />
  );
};

function OrgLevelFilter({
  value,
  onChange,
}: {
  value: OrgLevel;
  onChange: (value: OrgLevel) => void;
}) {
  return (
    <Select
      value={value || "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : (v as OrgLevel))}
    >
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Org Level" />
      </SelectTrigger>
      <SelectContent>
        {ORG_LEVEL_OPTIONS.map((opt) => (
          <SelectItem key={opt.value || "all"} value={opt.value || "all"}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
