import type { OrgType } from "./types";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { LAYER_TYPES, normalizeOrgType } from "./org-chart";

/** Use stable public URL metadata for URL names, including irregular plurals. */
function toPlural(t: OrgType): string {
  return orgTypeDisplay[t].urlSegment;
}

/** Match navigable public URL names first; also accept singular and legacy plural names. */
function fromPlural(s: string): OrgType | null {
  const namedLayer = LAYER_TYPES.find(
    (type) => orgTypeDisplay[type].urlSegment === s.trim().toLowerCase(),
  );
  if (namedLayer) return namedLayer;
  const value = s.trim().toLowerCase();
  const singular = value.endsWith("s") ? value.slice(0, -1) : value;
  const normalized = normalizeOrgType(singular) ?? normalizeOrgType(value);
  return normalized && LAYER_TYPES.includes(normalized) ? normalized : null;
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

// ── Map viewport (?at=lat,lng,zoom) ─────────────────────────────────────────

export interface MapViewport {
  lat: number;
  lng: number;
  zoom: number;
}

/** The saved map center and zoom, or null when absent or out of range. */
export function readViewportFromUrl(): MapViewport | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("at");
  if (!param) return null;
  const parts = param.split(",");
  if (parts.length !== 3 || parts.some((p) => p.trim() === "")) return null;
  const [lat, lng, zoom] = parts.map(Number) as [number, number, number];
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (zoom < 2 || zoom > 20) return null;
  return { lat, lng, zoom };
}

/** Save the map center and zoom, keeping the org/level already in the URL. */
export function writeViewportToUrl({ lat, lng, zoom }: MapViewport): void {
  const params = new URLSearchParams(window.location.search);
  const round = (n: number) => Number(n.toFixed(5));
  params.set("at", `${round(lat)},${round(lng)},${round(zoom)}`);
  window.history.replaceState(null, "", `?${params.toString()}`);
}

/** Point the Map at one org (or Nation), with its default level and fit. */
export function writeMapFocusUrl(orgId: number | null): void {
  window.history.replaceState(null, "", orgId == null ? "./" : `?org=${orgId}`);
}

// ── View and Table filters (?view=table&orgs=1,2,3) ──────────────────────────

export type DirectoryView = "map" | "table";

export function readViewFromUrl(): DirectoryView {
  if (typeof window === "undefined") return "map";
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "table" ? "table" : "map";
}

/** The Table's checked org ids; invalid entries are dropped. */
export function readTableOrgIdsFromUrl(): number[] {
  if (typeof window === "undefined") return [];
  const param = new URLSearchParams(window.location.search).get("orgs");
  if (!param) return [];
  const ids = param
    .split(",")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

/** Save the Table view and its checked orgs (replacing any Map state). */
export function writeTableUrlState(orgIds: readonly number[]): void {
  const params = new URLSearchParams({ view: "table" });
  if (orgIds.length > 0) params.set("orgs", orgIds.join(","));
  // Commas read better than %2C in a shared link.
  window.history.replaceState(
    null,
    "",
    `?${params.toString().replace(/%2C/g, ",")}`,
  );
}
