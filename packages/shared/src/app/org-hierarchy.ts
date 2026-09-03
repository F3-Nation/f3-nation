import { OrgType } from "./enums";

/**
 * Leaf (ao) is rank 0; root (nation) is the highest rank. Derived from
 * OrgType's array order — see the load-bearing-order comment on OrgType.
 */
export const orgTypeRank = (t: OrgType): number => OrgType.indexOf(t);

/**
 * True if `parent` sits above `child` in the org hierarchy (strictly
 * higher rank). Used to validate an org's parent assignment.
 */
export const isValidOrgTypeParent = (
  parent: OrgType,
  child: OrgType,
): boolean => orgTypeRank(parent) > orgTypeRank(child);

export interface OrgTypeDisplayInfo {
  /** Singular display label, e.g. "Region" */
  label: string;
  /** Plural display label, e.g. "Regions" */
  pluralLabel: string;
  /** Admin route segment under /admin, e.g. "regions" (matches routes.admin.*) */
  routeSegment: string;
  /** lucide-react icon name; consumers resolve this to a component */
  icon: string;
}

export const orgTypeDisplay: Record<OrgType, OrgTypeDisplayInfo> = {
  ao: {
    label: "AO",
    pluralLabel: "AOs",
    routeSegment: "aos",
    icon: "CircleSmall",
  },
  region: {
    label: "Region",
    pluralLabel: "Regions",
    routeSegment: "regions",
    icon: "CirclePile",
  },
  area: {
    label: "Area",
    pluralLabel: "Areas",
    routeSegment: "areas",
    icon: "Earth",
  },
  sector: {
    label: "Sector",
    pluralLabel: "Sectors",
    routeSegment: "sectors",
    icon: "Globe",
  },
  nation: {
    label: "Nation",
    pluralLabel: "The Nation",
    routeSegment: "the-nation",
    icon: "Shield",
  },
};
