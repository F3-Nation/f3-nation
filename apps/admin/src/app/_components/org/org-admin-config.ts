import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay, orgTypesAbove } from "@acme/shared/app/org-hierarchy";
import {
  AdminAreaAncestorOrgTypes,
  AdminHierarchyOrgTypes,
} from "./org-ancestry";

/**
 * Ancestor filters for an org table. `tiers` are the pickers, top-down: the
 * selection narrows the later pickers and prunes their selections. Pickers
 * always offer active orgs only.
 *
 * `match` turns selections into the query's `parentOrgIds`. The deepest tier
 * with a selection decides:
 * - In `match.tiers`: its selected IDs are sent as-is.
 * - Otherwise it expands to the loaded orgs beneath it (those whose type is in
 *   the table's `ancestorTypes`), and the table's
 *   active/inactive policy applies:
 *   - `includeInactive: true` keeps the selection plus every descendant whose
 *     type is in `ancestorTypes`, active or not, so rows under an inactive parent stay
 *     reachable, including Regions directly beneath a Territory or beneath an
 *     inactive Area.
 *   - `includeInactive: false` keeps only active descendants whose type is in
 *     `match.tiers`.
 * An expansion that matches nothing sends no valid parent, so the table is
 * empty rather than unfiltered.
 */
interface OrgHierarchyFilter {
  tiers: readonly OrgType[];
  resetPageOnReconcile?: boolean;
  match: { tiers: readonly OrgType[]; includeInactive: boolean };
}

interface OrgAdminConfigBase {
  heading?: string;
  nameColumn?: string;
  add: boolean;
  serverPagination: boolean;
  serverSorting: boolean;
  ancestorTypes?: OrgType[];
  /**
   * Display-only traversal of irregular legacy/imported or directly written data.
   * The API rejects new same-tier parenting; these nodes are not filter choices.
   */
  intermediateTypes?: OrgType[];
  displayAncestors?: OrgType[];
  columns: {
    key: string;
    label: string;
    id?: string;
    parentType?: OrgType;
  }[];
  statusId: "status" | "isActive";
  aoCount: boolean;
  inactiveAction?: boolean;
  actionSorting?: boolean;
  pageSizeOptions?: number[];
  emptySearch?: string;
  containerClassName?: string;
}

/**
 * `region` is the AO table's own-fetch region picker, whose selection is sent
 * as-is.
 */
export type OrgAdminConfig = OrgAdminConfigBase &
  (
    | { filters: "hierarchy"; hierarchyFilter: OrgHierarchyFilter }
    | { filters: "none" | "status" | "region"; hierarchyFilter?: undefined }
  );

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
  territory: {
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "hierarchy",
    hierarchyFilter: {
      tiers: ["sector"],
      match: { tiers: [], includeInactive: true },
    },
    ancestorTypes: orgTypesAbove("territory"),
    columns: [{ key: "parentOrgName", label: "Sector", parentType: "sector" }],
    statusId: "status",
    aoCount: true,
  },
  area: {
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "hierarchy",
    hierarchyFilter: {
      tiers: ["sector", "territory"],
      match: { tiers: ["territory"], includeInactive: true },
    },
    ancestorTypes: AdminAreaAncestorOrgTypes,
    intermediateTypes: ["area"],
    displayAncestors: ["territory", "sector"],
    columns: [
      { key: "territory", id: "territoryName", label: "Territory" },
      { key: "sector", id: "sectorName", label: "Sector" },
    ],
    statusId: "status",
    aoCount: true,
  },
  region: {
    add: true,
    serverPagination: true,
    serverSorting: false,
    filters: "hierarchy",
    hierarchyFilter: {
      tiers: ["sector", "territory", "area"],
      resetPageOnReconcile: true,
      match: { tiers: [], includeInactive: true },
    },
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
