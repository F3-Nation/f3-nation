import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import {
  AdminAreaAncestorOrgTypes,
  AdminHierarchyOrgTypes,
} from "./org-ancestry";

export interface OrgAdminConfig {
  heading?: string;
  nameColumn?: string;
  add: boolean;
  serverPagination: boolean;
  serverSorting: boolean;
  filters: "none" | "status" | "sector" | "sectorArea" | "region";
  ancestorTypes?: OrgType[];
  displayAncestors?: OrgType[];
  columns: { key: string; label: string; id?: string; parentType?: OrgType }[];
  statusId: "status" | "isActive";
  aoCount: boolean;
  inactiveAction?: boolean;
  actionSorting?: boolean;
  pageSizeOptions?: number[];
  emptySearch?: string;
  containerClassName?: string;
}

export const orgAdminConfig: Record<OrgType, OrgAdminConfig> = {
  nation: {
    heading: "Nations",
    add: false,
    serverPagination: false,
    serverSorting: false,
    filters: "none",
    columns: [],
    statusId: "isActive",
    aoCount: false,
    inactiveAction: true,
    actionSorting: true,
  },
  sector: {
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "status",
    columns: [],
    statusId: "status",
    aoCount: true,
  },
  area: {
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "sector",
    ancestorTypes: AdminAreaAncestorOrgTypes,
    displayAncestors: ["sector"],
    columns: [{ key: "sector", label: "Sector", id: "parentOrgName" }],
    statusId: "status",
    aoCount: true,
  },
  region: {
    add: true,
    serverPagination: true,
    serverSorting: false,
    filters: "sectorArea",
    ancestorTypes: AdminHierarchyOrgTypes,
    displayAncestors: ["area", "sector"],
    columns: [
      { key: "area", label: "Area" },
      { key: "sector", label: "Sector" },
    ],
    statusId: "isActive",
    aoCount: true,
    actionSorting: true,
    pageSizeOptions: [10, 20, 50, 100],
  },
  ao: {
    nameColumn: "Name",
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "region",
    columns: [{ key: "parentOrgName", label: "Region", parentType: "region" }],
    statusId: "isActive",
    aoCount: false,
    actionSorting: true,
    emptySearch: "",
    containerClassName: "max-w-full",
  },
};

export const orgAdminTypes = OrgType;
export const resolveOrgSegment = (segment: string) =>
  orgAdminTypes.find((type) => orgTypeDisplay[type].routeSegment === segment);
