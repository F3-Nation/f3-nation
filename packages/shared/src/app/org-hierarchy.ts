import { routes } from "./constants";
import { OrgType } from "./enums";

// routeSegment strips the leading "/" from a routes.admin.* __path so
// orgTypeDisplay derives from the single route source of truth instead of
// restating each segment as its own literal.
const stripLeadingSlash = (path: string) => path.replace(/^\//, "");

/**
 * Leaf (ao) is rank 0; root (nation) is the highest rank. Derived from
 * OrgType's array order — see the load-bearing-order comment on OrgType.
 */
export const orgTypeRank = (t: OrgType): number => OrgType.indexOf(t);

/**
 * True if `parent` sits above `child` in the org hierarchy (strictly
 * higher rank). Rank only; use `isPermittedOrgParent` to validate a parent assignment.
 */
export const isValidOrgTypeParent = (
  parent: OrgType,
  child: OrgType,
): boolean => orgTypeRank(parent) > orgTypeRank(child);

// An AO's parent must be a region, not just any higher-ranked type:
// moveAOLocsToNewRegion and the map's region joins both assume it, so a
// skip-level ao->sector/area/nation parent would silently break location and
// region attribution downstream.
const REQUIRED_PARENT_TYPE: Partial<Record<OrgType, OrgType>> = {
  ao: "region",
};

/**
 * True if `parent` may be assigned as `child`'s parent: it must outrank `child`
 * and, for a type with a required parent type, be exactly that type. This is
 * the rule the API enforces, so the admin editors' parent lists are checked
 * against it.
 */
export const isPermittedOrgParent = (
  parent: OrgType,
  child: OrgType,
): boolean =>
  isValidOrgTypeParent(parent, child) &&
  (REQUIRED_PARENT_TYPE[child] ?? parent) === parent;

/**
 * Every type that ranks strictly above `type`, nearest tier first (the types
 * for which `isValidOrgTypeParent(parent, type)` holds).
 */
export const orgTypesAbove = (type: OrgType): OrgType[] =>
  OrgType.filter((candidate) => isValidOrgTypeParent(candidate, type));

export interface OrgTypeDisplayInfo {
  /** Singular display label, e.g. "Region" */
  label: string;
  /** Plural display label, e.g. "Regions" */
  pluralLabel: string;
  /** Admin route segment under /admin, e.g. "regions" (matches routes.admin.*) */
  routeSegment: string;
  /** Stable public URL name, independent of admin routes and display labels. */
  urlSegment: string;
  /** lucide-react icon name; consumers resolve this to a component */
  icon:
    "CircleSmall" | "CirclePile" | "Earth" | "LandPlot" | "Globe" | "Shield";
}

export const orgTypeDisplay: Record<OrgType, OrgTypeDisplayInfo> = {
  ao: {
    urlSegment: "aos",
    label: "AO",
    pluralLabel: "AOs",
    routeSegment: stripLeadingSlash(routes.admin.aos.__path),
    icon: "CircleSmall",
  },
  region: {
    urlSegment: "regions",
    label: "Region",
    pluralLabel: "Regions",
    routeSegment: stripLeadingSlash(routes.admin.regions.__path),
    icon: "CirclePile",
  },
  area: {
    urlSegment: "areas",
    label: "Area",
    pluralLabel: "Areas",
    routeSegment: stripLeadingSlash(routes.admin.areas.__path),
    icon: "Earth",
  },
  territory: {
    urlSegment: "territories",
    label: "Territory",
    pluralLabel: "Territories",
    routeSegment: stripLeadingSlash(routes.admin.territories.__path),
    icon: "LandPlot",
  },
  sector: {
    urlSegment: "sectors",
    label: "Sector",
    pluralLabel: "Sectors",
    routeSegment: stripLeadingSlash(routes.admin.sectors.__path),
    icon: "Globe",
  },
  nation: {
    urlSegment: "nations",
    label: "Nation",
    pluralLabel: "The Nation",
    routeSegment: stripLeadingSlash(routes.admin.theNation.__path),
    icon: "Shield",
  },
};
