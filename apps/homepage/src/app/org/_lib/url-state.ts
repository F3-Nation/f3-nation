import type { OrgType } from "./types";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { LAYER_TYPES, normalizeOrgType } from "./org-chart";

/** Use shared route metadata for URL names, including irregular plurals. */
function toPlural(t: OrgType): string {
  return orgTypeDisplay[t].routeSegment;
}

/** Match navigable route segments first; also accept singular and legacy plural names. */
function fromPlural(s: string): OrgType | null {
  const namedLayer = LAYER_TYPES.find(
    (type) => orgTypeDisplay[type].routeSegment === s.trim().toLowerCase(),
  );
  if (namedLayer) return namedLayer;
  const singular = s.endsWith("s") ? s.slice(0, -1) : s;
  return normalizeOrgType(singular) ?? normalizeOrgType(s);
}

export function readLevelFromUrl(): OrgType | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("level");
  if (!param) return null;
  return fromPlural(param);
}

export function readOrgIdFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("org");
  if (!param) return null;
  const id = Number(param);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function writeUrlState(level: OrgType, orgId: number | null): void {
  const params = new URLSearchParams();
  // Layers are ordered leaf → root; omit the configured broadest layer.
  if (level !== LAYER_TYPES[LAYER_TYPES.length - 1]) {
    params.set("level", toPlural(level));
  }
  if (orgId != null) params.set("org", String(orgId));
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : "./");
}
