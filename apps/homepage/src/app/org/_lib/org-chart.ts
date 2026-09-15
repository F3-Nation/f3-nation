import { OrgType as ORG_TYPES } from "@acme/shared/app/enums";
import type { OrgType } from "@acme/shared/app/enums";

import type { Org, OrgChartItem, OrgMetrics, Point } from "./types";

/**
 * Canonical org type order, leaf → root.
 * Derived from @acme/shared so a new tier (e.g. "territory") only needs one
 * update there; every loop, rank lookup, and level button here adapts
 * automatically.
 */
// Not exported — consumers derive what they need from LAYER_TYPES/orgTypeRank.
const ORG_TYPE_ORDER: readonly OrgType[] = ORG_TYPES;

/** Types shown as navigable map layers (everything between AO and Nation). */
export const LAYER_TYPES: OrgType[] = ORG_TYPE_ORDER.filter(
  (t) => t !== "ao" && t !== "nation",
);

/** Lower rank = closer to leaf. */
export function orgTypeRank(orgType: OrgType): number {
  return ORG_TYPE_ORDER.indexOf(orgType);
}

/**
 * Returns the OrgType if recognized, null otherwise.
 * Returning null (not a fallback) is intentional: unrecognized org types
 * must not be silently coerced into a valid-looking type.
 */
export function normalizeOrgType(value: unknown): OrgType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (ORG_TYPE_ORDER as readonly string[]).includes(normalized)
    ? (normalized as OrgType)
    : null;
}

export function buildOrgHierarchy(items: OrgChartItem[]): {
  orgById: Map<number, Org>;
  childrenByParent: Map<number, Org[]>;
  pointsById: Map<number, Point[]>;
  metricsById: Map<number, OrgMetrics>;
  /** Per-org location entries with IDs — used to render map pins. */
  orgLocationsById: Map<
    number,
    { locationId: number; lat: number; lng: number }[]
  >;
} {
  const orgById = new Map<number, Org>();

  const ensureOrg = (
    id: number,
    orgType: OrgType,
    name?: string | null,
    parentId?: number | null,
  ) => {
    const existing = orgById.get(id);
    if (existing) {
      if (name && existing.name.startsWith("Org ")) existing.name = name;
      if (parentId != null && existing.parentId == null)
        existing.parentId = parentId;
      return;
    }
    orgById.set(id, {
      id,
      name: name ?? (id === 1 ? "Nation" : `Org ${id}`),
      orgType,
      parentId: parentId ?? null,
    });
  };

  for (const item of items) {
    // Trust the API's type field — don't guess.
    const orgType = normalizeOrgType(item.orgType);
    if (!orgType) continue;

    // Remove unknown tiers before linking parents so recognized descendants
    // stay attached to their nearest recognized ancestor in an older bundle.
    const hierarchy = item.hierarchy.flatMap(([id, name, rawType]) => {
      const ancestorType = normalizeOrgType(rawType);
      return ancestorType ? [{ id, name, orgType: ancestorType }] : [];
    });
    const parentId = hierarchy[0]?.id ?? null;
    ensureOrg(item.orgId, orgType, item.name, parentId);

    for (const [i, ancestor] of hierarchy.entries()) {
      ensureOrg(
        ancestor.id,
        ancestor.orgType,
        ancestor.name,
        hierarchy[i + 1]?.id ?? null,
      );
    }
  }

  const childrenByParent = new Map<number, Org[]>();
  for (const org of orgById.values()) {
    if (org.parentId == null) continue;
    const list = childrenByParent.get(org.parentId) ?? [];
    list.push(org);
    childrenByParent.set(org.parentId, list);
  }

  const pointsById = new Map<number, Point[]>();
  const metricsById = new Map<number, OrgMetrics>();
  const orgLocationsById = new Map<
    number,
    { locationId: number; lat: number; lng: number }[]
  >();

  for (const item of items) {
    const points: Point[] = item.activeLocations.map((loc) => ({
      lat: loc.latitude,
      lng: loc.longitude,
    }));
    if (points.length > 0) pointsById.set(item.orgId, points);

    const locations = item.activeLocations.map((loc) => ({
      locationId: loc.locationId,
      lat: loc.latitude,
      lng: loc.longitude,
    }));
    if (locations.length > 0) orgLocationsById.set(item.orgId, locations);

    // Metrics merge co-located records so an AO with events at multiple
    // records sharing coordinates isn't counted more than once (the API
    // returns distinct locationIds for pin rendering, not for counting).
    const byCoord = new Map<string, { events: number; aos: number }>();
    for (const loc of item.activeLocations) {
      const key = `${loc.latitude},${loc.longitude}`;
      const merged = byCoord.get(key) ?? { events: 0, aos: 0 };
      merged.events += loc.eventCount;
      merged.aos = Math.max(merged.aos, loc.aoCount);
      byCoord.set(key, merged);
    }
    let events = 0;
    let aos = 0;
    for (const merged of byCoord.values()) {
      events += merged.events;
      aos += merged.aos;
    }
    metricsById.set(item.orgId, {
      events,
      aos,
      locations: byCoord.size,
    });
  }

  return {
    orgById,
    childrenByParent,
    pointsById,
    metricsById,
    orgLocationsById,
  };
}
