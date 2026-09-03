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
 * higher rank). Intended for validating an org's parent assignment
 * (not yet wired into any endpoint).
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
  icon: "CircleSmall" | "CirclePile" | "Earth" | "Globe" | "Shield";
}

export const orgTypeDisplay: Record<OrgType, OrgTypeDisplayInfo> = {
  ao: {
    label: "AO",
    pluralLabel: "AOs",
    routeSegment: stripLeadingSlash(routes.admin.aos.__path),
    icon: "CircleSmall",
  },
  region: {
    label: "Region",
    pluralLabel: "Regions",
    routeSegment: stripLeadingSlash(routes.admin.regions.__path),
    icon: "CirclePile",
  },
  area: {
    label: "Area",
    pluralLabel: "Areas",
    routeSegment: stripLeadingSlash(routes.admin.areas.__path),
    icon: "Earth",
  },
  sector: {
    label: "Sector",
    pluralLabel: "Sectors",
    routeSegment: stripLeadingSlash(routes.admin.sectors.__path),
    icon: "Globe",
  },
  nation: {
    label: "Nation",
    pluralLabel: "The Nation",
    routeSegment: stripLeadingSlash(routes.admin.theNation.__path),
    icon: "Shield",
  },
};
