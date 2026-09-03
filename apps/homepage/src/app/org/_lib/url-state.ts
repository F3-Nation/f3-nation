import type { OrgType } from "./types";
import { normalizeOrgType } from "./org-chart";

/** Legacy numeric-to-named mapping for old bookmarked URLs (?level=0, etc.). */
const LEGACY_NUMERIC: Record<string, OrgType> = {
  "0": "sector",
  "1": "area",
  "2": "region",
  "3": "ao",
};

/** "sector" → "sectors" */
function toPlural(t: OrgType): string {
  return `${t}s`;
}

/** "sectors" → "sector", "sector" → "sector" (both accepted) */
function fromPlural(s: string): OrgType | null {
  const singular = s.endsWith("s") ? s.slice(0, -1) : s;
  return normalizeOrgType(singular) ?? normalizeOrgType(s);
}

export function readLevelFromUrl(): OrgType | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("level");
  if (!param) return null;
  if (/^\d+$/.test(param)) return LEGACY_NUMERIC[param] ?? null;
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
  // Omit the param when at the default top-level (sectors)
  if (level !== "sector") params.set("level", toPlural(level));
  if (orgId != null) params.set("org", String(orgId));
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : "./");
}
