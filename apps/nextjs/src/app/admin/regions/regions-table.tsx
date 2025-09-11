"use client";

import type { TableOptions } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AreaFilter } from "./area-filter";
import { RegionIsActiveFilter } from "./region-is-active-filter";
import { SectorFilter } from "./sector-filter";

type Org = NonNullable<RouterOutputs["org"]["all"]>["orgs"][number];

export const RegionsTable = ({
  regions,
  sectors,
  areas,
}: {
  regions: Org[];
  sectors: Org[];
  areas: Org[];
}) => {
  const [selectedSectors, setSelectedSectors] = useState<Org[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);

  useEffect(() => {
    const selectedSectorsIds = selectedSectors.map((sector) => sector.id);
    setSelectedAreas((selectedAreas) =>
      selectedAreas.filter(
        (area) =>
          !selectedSectorsIds.length ||
          (!!area.parentId && selectedSectorsIds.includes(area.parentId)),
      ),
    );
  }, [areas, selectedSectors]);

  const idToAreaMap = useMemo(() => {
    return areas.reduce(
      (acc, area) => {
        acc[area.id] = area;
        return acc;
      },
      {} as Record<number, Org>,
    );
  }, [areas]);

  const idToSectorMap = useMemo(() => {
    return sectors.reduce(
      (acc, sector) => {
        acc[sector.id] = sector;
        return acc;
      },
      {} as Record<number, Org>,
    );
  }, [sectors]);

  const filteredRegions = useMemo(() => {
    return regions
      .map((region) => {
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
          selectedStatuses.includes(region.isActive ? "active" : "inactive") &&
          (!selectedSectors.length ||
            selectedSectors.some((s) => s.name === region.sector)) &&
          (!selectedAreas.length ||
            selectedAreas.some((a) => a.name === region.area))
        );
      });
  }, [
    regions,
    idToAreaMap,
    idToSectorMap,
    selectedStatuses,
    selectedSectors,
    selectedAreas,
  ]);

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
      filterComponent={
        <>
          <SectorFilter
            onSectorSelect={handleSectorSelect}
            selectedSectors={selectedSectors}
          />
          <AreaFilter
            selectedSectors={selectedSectors}
            onAreaSelect={handleAreaSelect}
            selectedAreas={selectedAreas}
          />
          <RegionIsActiveFilter
            onStatusSelect={handleStatusSelect}
            selectedStatuses={selectedStatuses}
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
