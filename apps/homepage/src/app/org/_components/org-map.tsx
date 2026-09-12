"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import type {
  Org,
  OrgDetail,
  OrgMetrics,
  OrgType,
  Point,
  LocationDetail,
} from "../_lib/types";
import { buildOrgHierarchy, LAYER_TYPES } from "../_lib/org-chart";
import {
  convexHull,
  createCircleBuffer,
  createStarPolygon,
  dedupePoints,
  fuzzyScore,
  polygonAreaSqMi,
} from "../_lib/geo-utils";
import {
  getDescendants,
  getLevelOrgs,
  getOrgPath,
  isGeneralInternationalArea,
  isInternationalSector,
  nextNavigableLevel,
  pathForNavigatingTo,
} from "../_lib/navigation";
import { fetchLocationById, fetchOrgById, fetchOrgChart } from "../_lib/api";
import {
  readLevelFromUrl,
  readOrgIdFromUrl,
  writeUrlState,
} from "../_lib/url-state";
import type { NearestAdminOrg } from "./org-info-panel";
import { OrgInfoPanel } from "./org-info-panel";
import { LocationInfoPanel } from "./location-info-panel";
import { SearchBox } from "./search-box";

// ─── types local to this component ───────────────────────────────────────────

type InfoState =
  | { status: "idle" }
  | { status: "loading"; org: Org }
  | { status: "loaded"; org: Org; detail: OrgDetail }
  | { status: "error"; org: Org }
  | { status: "loading-location"; locationId: number }
  | { status: "loaded-location"; locationId: number; detail: LocationDetail }
  | { status: "error-location"; locationId: number };

// ─── helpers ─────────────────────────────────────────────────────────────────

function getOrgColor(orgId: number, cache: Map<number, string>): string {
  const cached = cache.get(orgId);
  if (cached) return cached;
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  cache.set(orgId, color);
  return color;
}

function getOrgPoints(
  org: Org,
  childrenByParent: Map<number, Org[]>,
  pointsById: Map<number, Point[]>,
  descendantCache: Map<number, number[]>,
): Point[] {
  const ids = getDescendants(org.id, childrenByParent, descendantCache);
  const pts: Point[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = pointsById.get(id);
    if (p) pts.push(...p);
  }
  return pts;
}

function getAggregatedMetrics(
  org: Org,
  childrenByParent: Map<number, Org[]>,
  metricsById: Map<number, OrgMetrics>,
  descendantCache: Map<number, number[]>,
): OrgMetrics {
  const ids = getDescendants(org.id, childrenByParent, descendantCache);
  let events = 0;
  let aos = 0;
  let locations = 0;
  for (const id of ids) {
    const m = metricsById.get(id);
    if (!m) continue;
    events += m.events;
    aos += m.aos;
    locations += m.locations;
  }
  return { events, aos, locations };
}

function getLatLngsForOrg(
  org: Org,
  childrenByParent: Map<number, Org[]>,
  pointsById: Map<number, Point[]>,
  descendantCache: Map<number, number[]>,
): L.LatLng[] | null {
  if (isInternationalSector(org) || isGeneralInternationalArea(org)) {
    const star = createStarPolygon({ lat: 20, lng: -40 }, 8, 5);
    return star.map((p) => L.latLng(p.lat, p.lng));
  }
  const pts = getOrgPoints(org, childrenByParent, pointsById, descendantCache);
  if (pts.length === 0) return null;

  // Branch on the count of *distinct* coordinates, not raw points: convexHull
  // collapses duplicate/collinear points, so 3+ points spanning only 1–2
  // distinct spots would otherwise yield a <3-vertex hull and no polygon.
  const distinct = dedupePoints(pts);
  const circleFrom = (center: { lat: number; lng: number }) =>
    createCircleBuffer(center, 0.15).map((p) => L.latLng(p.lat, p.lng));

  if (distinct.length < 3) {
    const center =
      distinct.length === 2
        ? {
            lat: (distinct[0]!.lat + distinct[1]!.lat) / 2,
            lng: (distinct[0]!.lng + distinct[1]!.lng) / 2,
          }
        : { lat: distinct[0]!.lat, lng: distinct[0]!.lng };
    return circleFrom(center);
  }
  const hull = convexHull(distinct);
  if (hull.length < 3) {
    // Distinct points were collinear — fall back to a circle at their centroid
    // so the org still renders instead of vanishing.
    const center = {
      lat: distinct.reduce((s, p) => s + p.lat, 0) / distinct.length,
      lng: distinct.reduce((s, p) => s + p.lng, 0) / distinct.length,
    };
    return circleFrom(center);
  }
  return hull.map((p) => L.latLng(p.lat, p.lng));
}

function getFocusBounds(
  org: Org,
  childrenByParent: Map<number, Org[]>,
  pointsById: Map<number, Point[]>,
  descendantCache: Map<number, number[]>,
): L.LatLngBounds | null {
  const latLngs = getLatLngsForOrg(
    org,
    childrenByParent,
    pointsById,
    descendantCache,
  );
  return latLngs ? L.latLngBounds(latLngs) : null;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function OrgMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Stable data refs — don't trigger re-renders
  const orgByIdRef = useRef(new Map<number, Org>());
  const childrenByParentRef = useRef(new Map<number, Org[]>());
  const pointsByIdRef = useRef(new Map<number, Point[]>());
  const metricsByIdRef = useRef(new Map<number, OrgMetrics>());
  const orgColorsRef = useRef(new Map<number, string>());
  const descendantCacheRef = useRef(new Map<number, number[]>());
  const orgInfoCacheRef = useRef(new Map<number, OrgDetail>());
  const activeInfoOrgIdRef = useRef<number | null>(null);
  // Debounces hover-driven info loads so sweeping the cursor across a dense
  // layer doesn't fire a fetch (plus ancestor climbs) per polygon.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const orgLocationsRef = useRef(
    new Map<number, { locationId: number; lat: number; lng: number }[]>(),
  );
  const locationInfoCacheRef = useRef(new Map<number, LocationDetail>());
  const activeLocationIdRef = useRef<number | null>(null);
  // Dedup in-flight org detail requests so rapid hovers share one fetch
  const orgInfoPendingRef = useRef(new Map<number, Promise<OrgDetail>>());
  const locationInfoPendingRef = useRef(
    new Map<number, Promise<LocationDetail>>(),
  );
  // True while location pins are displayed; suppresses polygon hover updates
  const pinsActiveRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState<OrgType>("sector");
  const [selectedPath, setSelectedPath] = useState<Org[]>([]);
  const [infoState, setInfoState] = useState<InfoState>({ status: "idle" });
  const [nearestAdminOrg, setNearestAdminOrg] =
    useState<NearestAdminOrg | null>(null);
  // True when the ancestor climb couldn't verify admins (a lookup failed),
  // so the UI can say "couldn't check" instead of a false "none listed".
  const [adminLookupInconclusive, setAdminLookupInconclusive] = useState(false);

  // Layers actually present in the data (depth-agnostic)
  const [presentLayers, setPresentLayers] = useState<OrgType[]>(LAYER_TYPES);

  // ── initial data load ────────────────────────────────────────────────────

  useEffect(() => {
    fetchOrgChart()
      .then((items) => {
        const {
          orgById,
          childrenByParent,
          pointsById,
          metricsById,
          orgLocationsById,
        } = buildOrgHierarchy(items);
        orgByIdRef.current = orgById;
        childrenByParentRef.current = childrenByParent;
        pointsByIdRef.current = pointsById;
        metricsByIdRef.current = metricsById;
        orgLocationsRef.current = orgLocationsById;
        descendantCacheRef.current.clear();

        // Derive which layer types are actually present
        const typesPresent = new Set<OrgType>();
        for (const org of orgById.values()) typesPresent.add(org.orgType);
        const layers = LAYER_TYPES.filter((t) => typesPresent.has(t));
        const navigableLayers = layers.length > 0 ? layers : LAYER_TYPES;
        setPresentLayers(navigableLayers);

        // Restore URL state
        const urlLevel = readLevelFromUrl();
        const urlOrgId = readOrgIdFromUrl();

        // Broadest layer = last in LAYER_TYPES (leaf→root order)
        let startLevel: OrgType =
          navigableLayers[navigableLayers.length - 1] ?? "sector";
        let startPath: Org[] = [];

        if (urlOrgId) {
          const urlOrg = orgById.get(urlOrgId);
          if (urlOrg) {
            const { path, level } = pathForNavigatingTo(
              urlOrg,
              orgById,
              childrenByParent,
              descendantCacheRef.current,
            );
            // Only honor a URL level override that names a navigable layer;
            // ao/nation (e.g. from a legacy ?level= link) aren't selectable.
            const overrideLevel =
              urlLevel && navigableLayers.includes(urlLevel) ? urlLevel : null;
            startLevel = overrideLevel ?? level;
            startPath = path;
            // Queue info load after render
            void loadOrgInfo(urlOrg);
          }
        } else if (urlLevel && navigableLayers.includes(urlLevel)) {
          startLevel = urlLevel;
        }

        // Always show Nation info when no specific org is deep-linked
        if (!urlOrgId) {
          const nation = orgById.get(1);
          if (nation) void loadOrgInfo(nation);
        }

        setCurrentLevel(startLevel);
        setSelectedPath(startPath);
        setIsLoaded(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setLoadError(msg);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Leaflet map init ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      worldCopyJump: true,
      minZoom: 2,
    }).setView([37.6, -96], 4);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2nwg_1_400751470e58d29b4569f556",
      {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
      },
    ).addTo(map);

    mapRef.current = map;
    layerGroupRef.current = L.layerGroup().addTo(map);
    // Pin layer sits on top of polygons
    pinLayerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // ── info loading ─────────────────────────────────────────────────────────

  const loadOrgInfo = useCallback(async (org: Org) => {
    if (activeInfoOrgIdRef.current !== org.id) {
      // Drop the previous org's fallback in the same commit as the new detail,
      // so a switch to an already-cached org can't render its admin for a frame.
      setNearestAdminOrg(null);
      setAdminLookupInconclusive(false);
    }
    activeInfoOrgIdRef.current = org.id;
    // A still-pending pin fetch must not override this org selection.
    activeLocationIdRef.current = null;

    const cached = orgInfoCacheRef.current.get(org.id);
    if (cached) {
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "loaded", org, detail: cached });
      }
      return;
    }

    setInfoState({ status: "loading", org });

    let pending = orgInfoPendingRef.current.get(org.id);
    if (!pending) {
      pending = fetchOrgById(org.id);
      orgInfoPendingRef.current.set(org.id, pending);
    }

    try {
      const detail = await pending;
      orgInfoCacheRef.current.set(org.id, detail);
      orgInfoPendingRef.current.delete(org.id);
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "loaded", org, detail });
      }
    } catch {
      orgInfoPendingRef.current.delete(org.id);
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "error", org });
      }
    }
  }, []);

  const loadLocationInfo = useCallback(async (locationId: number) => {
    activeLocationIdRef.current = locationId;
    activeInfoOrgIdRef.current = null;

    const cached = locationInfoCacheRef.current.get(locationId);
    if (cached) {
      if (activeLocationIdRef.current === locationId) {
        setInfoState({ status: "loaded-location", locationId, detail: cached });
      }
      return;
    }

    setInfoState({ status: "loading-location", locationId });

    let pending = locationInfoPendingRef.current.get(locationId);
    if (!pending) {
      pending = fetchLocationById(locationId);
      locationInfoPendingRef.current.set(locationId, pending);
    }

    try {
      const detail = await pending;
      locationInfoCacheRef.current.set(locationId, detail);
      locationInfoPendingRef.current.delete(locationId);
      if (activeLocationIdRef.current === locationId) {
        setInfoState({ status: "loaded-location", locationId, detail });
      }
    } catch {
      locationInfoPendingRef.current.delete(locationId);
      if (activeLocationIdRef.current === locationId) {
        setInfoState({ status: "error-location", locationId });
      }
    }
  }, []);

  const showPinsForOrg = useCallback(
    (org: Org) => {
      pinsActiveRef.current = true;
      // Cancel a queued hover load so it can't fire after the pins appear.
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      const pinLayer = pinLayerGroupRef.current;
      if (!pinLayer) return;
      pinLayer.clearLayers();

      const locations = orgLocationsRef.current.get(org.id) ?? [];

      // Group by exact coordinate so co-located pins can be fanned out
      // ("spiderfied") instead of stacking invisibly on top of one another.
      const byCoord = new Map<string, typeof locations>();
      for (const loc of locations) {
        const key = `${loc.lat},${loc.lng}`;
        const group = byCoord.get(key) ?? [];
        group.push(loc);
        byCoord.set(key, group);
      }

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#B70D06;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      for (const group of byCoord.values()) {
        group.forEach((loc, i) => {
          let { lat, lng } = loc;
          if (group.length > 1) {
            // Fan markers sharing a coordinate around a small circle (~65m)
            // so each stays individually hoverable/clickable.
            const angle = (2 * Math.PI * i) / group.length;
            const radius = 0.0006;
            lat += radius * Math.cos(angle);
            lng += radius * Math.sin(angle);
          }
          const marker = L.marker([lat, lng], { icon });

          marker.on("mouseover", () => {
            void loadLocationInfo(loc.locationId);
          });
          marker.on("click", () => {
            void loadLocationInfo(loc.locationId);
          });

          marker.addTo(pinLayer);
        });
      }
    },
    [loadLocationInfo],
  );

  // ── navigation helpers ───────────────────────────────────────────────────

  const navigateToOrg = useCallback(
    (org: Org) => {
      const { path, level } = pathForNavigatingTo(
        org,
        orgByIdRef.current,
        childrenByParentRef.current,
        descendantCacheRef.current,
      );
      setCurrentLevel(level);
      setSelectedPath(path);

      // Always record the selected org itself, not the last breadcrumb entry:
      // for a view-only leaf (region) the breadcrumb excludes the org, so
      // path[last] would be the parent area and break the deep-link.
      writeUrlState(level, org.id);

      const bounds = getFocusBounds(
        org,
        childrenByParentRef.current,
        pointsByIdRef.current,
        descendantCacheRef.current,
      );
      if (bounds && mapRef.current) {
        mapRef.current.fitBounds(bounds, { padding: [24, 24] });
      }

      void loadOrgInfo(org);
    },
    [loadOrgInfo],
  );

  const navigateViaLevelButton = useCallback(
    (level: OrgType) => {
      pinsActiveRef.current = false;
      pinLayerGroupRef.current?.clearLayers();
      setCurrentLevel(level);
      setSelectedPath([]);
      writeUrlState(level, null);

      // Show nation info
      const nation = orgByIdRef.current.get(1);
      if (nation) void loadOrgInfo(nation);
    },
    [loadOrgInfo],
  );

  const navigateViaBreadcrumb = useCallback(
    (depth: number) => {
      pinsActiveRef.current = false;
      pinLayerGroupRef.current?.clearLayers();
      if (depth === -1) {
        // Nation breadcrumb → broadest layer (last in leaf→root order)
        setSelectedPath([]);
        const topLevel = presentLayers[presentLayers.length - 1] ?? "sector";
        setCurrentLevel(topLevel);
        writeUrlState(topLevel, null);
        const nation = orgByIdRef.current.get(1);
        if (nation) void loadOrgInfo(nation);
        return;
      }
      const newPath = selectedPath.slice(0, depth + 1);
      setSelectedPath(newPath);
      const newLevel =
        newPath.length > 0
          ? (() => {
              const lastOrg = newPath[newPath.length - 1]!;
              // Drill to the next populated tier, skipping any empty level.
              return (
                nextNavigableLevel(
                  lastOrg,
                  orgByIdRef.current,
                  childrenByParentRef.current,
                  descendantCacheRef.current,
                ) ?? lastOrg.orgType
              );
            })()
          : (presentLayers[presentLayers.length - 1] ?? "sector");
      setCurrentLevel(newLevel);
      const lastOrg = newPath[newPath.length - 1];
      writeUrlState(newLevel, lastOrg?.id ?? null);
      if (lastOrg) void loadOrgInfo(lastOrg);
    },
    [selectedPath, presentLayers, loadOrgInfo],
  );

  // ── Leaflet layer render ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup || !isLoaded) return;

    layerGroup.clearLayers();
    // Clear pins whenever the polygon layer re-renders (level/path changed)
    pinsActiveRef.current = false;
    pinLayerGroupRef.current?.clearLayers();
    const allLatLngs: L.LatLng[] = [];

    const orgs = getLevelOrgs(
      currentLevel,
      selectedPath,
      orgByIdRef.current,
      childrenByParentRef.current,
      descendantCacheRef.current,
    );

    for (const org of orgs) {
      const latLngs = getLatLngsForOrg(
        org,
        childrenByParentRef.current,
        pointsByIdRef.current,
        descendantCacheRef.current,
      );
      if (!latLngs || latLngs.length < 3) continue;

      allLatLngs.push(...latLngs);
      const color = getOrgColor(org.id, orgColorsRef.current);

      const polygon = L.polygon(latLngs, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.18,
      });

      polygon.on("mouseover", () => {
        polygon.setStyle({ weight: 3, fillOpacity: 0.28 });
        // Suppress polygon hover info while location pins are shown
        if (!pinsActiveRef.current) {
          if (org.orgType === "region") writeUrlState(currentLevel, org.id);
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            // Re-check: pins may have been shown during the debounce window.
            if (!pinsActiveRef.current) void loadOrgInfo(org);
          }, 200);
        }
      });

      polygon.on("mouseout", () => {
        polygon.setStyle({ weight: 2, fillOpacity: 0.18 });
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
      });

      polygon.on("click", () => {
        if (org.orgType === LAYER_TYPES[0]) {
          // Leaf layer: show location pins for this org
          showPinsForOrg(org);
          return;
        }
        navigateToOrg(org);
      });

      polygon.addTo(layerGroup);
    }

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] });
    }

    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [
    isLoaded,
    currentLevel,
    selectedPath,
    loadOrgInfo,
    navigateToOrg,
    showPinsForOrg,
  ]);

  // ── nearest parent admin lookup (for empty-roles message) ───────────────

  useEffect(() => {
    if (
      infoState.status !== "loaded" ||
      (infoState.detail.roles?.length ?? 0) > 0
    ) {
      setNearestAdminOrg(null);
      setAdminLookupInconclusive(false);
      return;
    }

    const { org } = infoState;
    let cancelled = false;

    // Reset immediately so the previously-viewed org's admin isn't shown while
    // this org's asynchronous ancestor climb is still running.
    setNearestAdminOrg(null);
    setAdminLookupInconclusive(false);

    // Climb every ancestor, nation included: if the nation is the only level
    // with admins we still want to surface it rather than "No admins listed".
    const ancestors = getOrgPath(org.id, orgByIdRef.current)
      .filter((o) => o.id !== org.id)
      .reverse(); // nearest first

    let hadFailure = false;

    async function climb() {
      for (const ancestor of ancestors) {
        if (cancelled) return;

        let detail = orgInfoCacheRef.current.get(ancestor.id);
        if (!detail) {
          try {
            detail = await fetchOrgById(ancestor.id);
            if (!cancelled) orgInfoCacheRef.current.set(ancestor.id, detail);
          } catch {
            // Couldn't check this ancestor — distinct from "it has no admins".
            hadFailure = true;
            continue;
          }
        }

        if (cancelled) return;

        const admins = (detail.roles ?? []).filter(
          (r) => r.title?.toLowerCase().includes("admin") ?? false,
        );
        if (admins.length > 0) {
          // activeInfoOrgIdRef flips synchronously on switch (before any await
          // resolves), so a stale climb can't overwrite a newer org's panel.
          if (activeInfoOrgIdRef.current === org.id) {
            setNearestAdminOrg({
              name: ancestor.name,
              orgType: ancestor.orgType,
              adminNames: admins.map((a) => a.f3Name ?? "Unknown"),
            });
          }
          return;
        }
        // No admins here — keep climbing
      }

      // Reached the top with no admin found: only claim "none" when every
      // ancestor was actually checked; a failed lookup makes it inconclusive.
      if (!cancelled && activeInfoOrgIdRef.current === org.id) {
        setAdminLookupInconclusive(hadFailure);
      }
    }

    void climb().catch(() => {
      // An unexpected shape must surface as inconclusive, not a false "none".
      if (!cancelled && activeInfoOrgIdRef.current === org.id) {
        setAdminLookupInconclusive(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [infoState]);

  // ── search ───────────────────────────────────────────────────────────────

  const getSearchResults = useCallback(
    (query: string): Org[] => {
      const scored = [...orgByIdRef.current.values()]
        .filter((o) => presentLayers.includes(o.orgType))
        .map((org) => ({ org, score: fuzzyScore(query, org.name) }))
        .filter((x): x is { org: Org; score: number } => x.score != null)
        .sort((a, b) =>
          b.score !== a.score
            ? b.score - a.score
            : a.org.name.localeCompare(b.org.name),
        );
      return scored.slice(0, 8).map((x) => x.org);
    },
    [presentLayers],
  );

  // ── derived data for info panel ──────────────────────────────────────────

  const infoOrg =
    infoState.status === "idle" ||
    infoState.status === "loading-location" ||
    infoState.status === "loaded-location" ||
    infoState.status === "error-location"
      ? undefined
      : infoState.org;

  const infoDescendants = useMemo(() => {
    if (!infoOrg || !isLoaded) return [];
    const ids = getDescendants(
      infoOrg.id,
      childrenByParentRef.current,
      descendantCacheRef.current,
    );
    return ids
      .map((id) => orgByIdRef.current.get(id))
      .filter((o): o is Org => !!o);
  }, [infoOrg, isLoaded]);

  const infoMetrics = useMemo(() => {
    if (!infoOrg || !isLoaded) return undefined;
    return getAggregatedMetrics(
      infoOrg,
      childrenByParentRef.current,
      metricsByIdRef.current,
      descendantCacheRef.current,
    );
  }, [infoOrg, isLoaded]);

  const infoFootprint = useMemo(() => {
    if (!infoOrg || !isLoaded) return null;
    const detail = infoState.status === "loaded" ? infoState.detail : undefined;
    if ((detail?.orgType ?? infoOrg.orgType) !== "region") return null;
    const pts = getOrgPoints(
      infoOrg,
      childrenByParentRef.current,
      pointsByIdRef.current,
      descendantCacheRef.current,
    );
    if (pts.length < 3) return null;
    const hull = convexHull(pts);
    return hull.length >= 3 ? polygonAreaSqMi(hull) : null;
  }, [infoOrg, infoState, isLoaded]);

  // ── breadcrumb data ──────────────────────────────────────────────────────

  const crumbs = [
    { label: "Nation", depth: -1 },
    ...selectedPath.map((org, idx) => ({ label: org.name, depth: idx })),
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-[#f6f3ea]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 bg-[#0b0d12] px-6 py-4 text-[#f6f3ea] md:flex-nowrap md:gap-8">
        <div>
          <div className="text-lg font-bold">F3 Geographic Directory</div>
          <div className="text-xs text-[rgba(215,38,56,0.85)]">
            {presentLayers
              .slice()
              .reverse()
              .map((t) => orgTypeDisplay[t].pluralLabel)
              .join(" → ")}{" "}
            → {orgTypeDisplay.ao.pluralLabel}
          </div>
        </div>

        {/* Layer buttons — generated from data, depth-agnostic */}
        <nav className="flex flex-wrap gap-2" aria-label="Map layers">
          {presentLayers
            .slice()
            .reverse()
            .map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => navigateViaLevelButton(layer)}
                className={`rounded border px-4 py-2 text-xs font-medium tracking-wide uppercase transition-all ${
                  currentLevel === layer
                    ? "border-[#B70D06] bg-[#B70D06] text-[#1a1a1a]"
                    : "border-[#2c3648] bg-[#151a24] text-[#f8f4ea] hover:border-[#3b4a62] hover:bg-[#233046]"
                }`}
              >
                {orgTypeDisplay[layer].pluralLabel}
              </button>
            ))}
        </nav>

        {/* Breadcrumb */}
        <nav
          className="flex-1 text-sm md:flex-none"
          aria-label="Location breadcrumb"
        >
          {crumbs.map((crumb, idx) => {
            const isLast = idx === crumbs.length - 1;
            const isNation = crumb.depth === -1;
            return (
              <span key={crumb.depth}>
                {idx > 0 && <span className="mx-2 text-[#e8e2d2]/50">/</span>}
                <button
                  type="button"
                  onClick={() => navigateViaBreadcrumb(crumb.depth)}
                  className={`transition-colors ${
                    isLast && !isNation
                      ? "text-[rgba(215,38,56,0.8)] hover:text-[rgba(215,38,56,1)]"
                      : "cursor-pointer hover:underline"
                  }`}
                >
                  {crumb.label}
                </button>
              </span>
            );
          })}
        </nav>
      </header>

      {/* Main content */}
      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 md:grid-cols-[1fr_320px]">
        {/* Map */}
        <div className="relative min-h-[60vh] overflow-hidden rounded-2xl shadow-xl md:min-h-0">
          {/* Loading overlay */}
          {!isLoaded && !loadError && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(11,13,18,0.4)] text-[#f8f4ea]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(248,244,234,0.3)] border-t-[#f8f4ea]" />
              <span className="text-sm font-medium">Loading map data…</span>
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(11,13,18,0.4)] text-[#f8f4ea]">
              <span className="text-sm">Failed to load: {loadError}</span>
            </div>
          )}
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-3 overflow-y-auto">
          <div className="rounded-2xl bg-white p-4 shadow-md">
            <SearchBox
              getResults={getSearchResults}
              onSelect={navigateToOrg}
              disabled={!isLoaded}
            />
          </div>
          <div className="flex flex-1 flex-col gap-3 rounded-2xl bg-white p-5 shadow-md">
            {infoState.status === "loading-location" ||
            infoState.status === "loaded-location" ||
            infoState.status === "error-location" ? (
              <LocationInfoPanel
                status={
                  infoState.status === "loading-location"
                    ? "loading"
                    : infoState.status === "error-location"
                      ? "error"
                      : "loaded"
                }
                locationId={infoState.locationId}
                detail={
                  infoState.status === "loaded-location"
                    ? infoState.detail
                    : undefined
                }
              />
            ) : (
              <OrgInfoPanel
                status={infoState.status}
                org={infoOrg}
                detail={
                  infoState.status === "loaded" ? infoState.detail : undefined
                }
                descendantOrgs={infoDescendants}
                aggregatedMetrics={infoMetrics}
                footprintSqMi={infoFootprint}
                nearestAdminOrg={nearestAdminOrg}
                adminLookupInconclusive={adminLookupInconclusive}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
