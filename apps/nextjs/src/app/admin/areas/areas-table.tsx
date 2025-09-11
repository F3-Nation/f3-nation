"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";

import type { RouterOutputs } from "@acme/api";
import type { IsActiveStatus } from "@acme/shared/app/enums";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { MDTable } from "@acme/ui/md-table";
import { Cell, Header } from "@acme/ui/table";

import { DeleteType, ModalType, openModal } from "~/utils/store/modal";
import { SectorFilter } from "../regions/sector-filter";
import { AreaIsActiveFilter } from "./area-is-active-filter";

type Org = NonNullable<RouterOutputs["org"]["all"]>["orgs"][number];

export const AreasTable = ({
  areas,
  sectors,
}: {
  areas: RouterOutputs["org"]["all"]["orgs"];
  sectors: RouterOutputs["org"]["all"]["orgs"];
}) => {
  const [selectedSectors, setSelectedSectors] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);

  const idToSectorMap = useMemo(() => {
    return sectors.reduce(
      (acc, sector) => {
        acc[sector.id] = sector;
        return acc;
      },
      {} as Record<number, Org>,
    );
  }, [sectors]);

  const filteredAreas = useMemo(() => {
    return areas
      .map((area) => {
        const sector = area.parentId ? idToSectorMap?.[area.parentId] : null;
        return {
          ...area,
          sector: sector?.name,
        };
      })
      .filter((area) => {
        return (
          selectedStatuses.includes(area.isActive ? "active" : "inactive") &&
          (!selectedSectors.length ||
            selectedSectors.some((s) => s.name === area.sector))
        );
      });
  }, [areas, idToSectorMap, selectedSectors, selectedStatuses]);

  const handleStatusSelect = useCallback((status: IsActiveStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      }
      return [...prev, status];
    });
  }, []);

  const handleSectorSelect = useCallback((sector: Org) => {
    setSelectedSectors((prev) => {
      if (prev.includes(sector)) {
        return prev.filter((s) => s !== sector);
      }
      return [...prev, sector];
    });
  }, []);

  return (
    <MDTable
      data={filteredAreas}
      cellClassName="p-1"
      paginationOptions={{ pageSize: 20 }}
      columns={columns}
      onRowClick={(row) => {
        openModal(ModalType.ADMIN_AREAS, { id: row.original.id });
      }}
      filterComponent={
        <>
          <SectorFilter
            onSectorSelect={handleSectorSelect}
            selectedSectors={selectedSectors}
          />
          <AreaIsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
          />
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
                  type: DeleteType.AREA,
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
