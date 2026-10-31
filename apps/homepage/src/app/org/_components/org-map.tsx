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
  AoSearchResult,
} from "../_lib/types";
import { buildOrgHierarchy, LAYER_TYPES } from "../_lib/org-chart";
import {
  computeFanOffsets,
  convexHull,
  fanRadiusForTargets,
  createCircleBuffer,
  panToContain,
  createStarPolygon,
  dedupePoints,
  fuzzyScore,
  polygonAreaSqMi,
} from "../_lib/geo-utils";
import { InfoRequestGuard } from "../_lib/info-request-guard";
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

// Minimum screen-pixel radius of the fan used to separate co-located location
// pins; larger groups widen it so their tap targets don't overlap.
const PIN_FAN_RADIUS_PX = 18;

// Square tap target around each 14px pin dot — finger-sized on phones.
const PIN_TAP_TARGET_PX = 32;

// Matches the `org-wide` custom variant in globals.css: where the layout
// switches from the phone overlay (floating search + bottom sheet) to the
// side-by-side sidebar.
const DESKTOP_MEDIA_QUERY =
  "(min-width: 768px), (max-height: 500px) and (orientation: landscape)";

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
  // Phone-only overlays that cover the map; fits are padded to clear them.
  const searchCardRef = useRef<HTMLDivElement>(null);
  const infoSheetRef = useRef<HTMLElement>(null);
  const breadcrumbRef = useRef<HTMLElement>(null);
  const layerNavRef = useRef<HTMLElement>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Stable data refs — don't trigger re-renders
  const orgByIdRef = useRef(new Map<number, Org>());
  const childrenByParentRef = useRef(new Map<number, Org[]>());
  const pointsByIdRef = useRef(new Map<number, Point[]>());
  const metricsByIdRef = useRef(new Map<number, OrgMetrics>());
  const orgColorsRef = useRef(new Map<number, string>());
  const descendantCacheRef = useRef(new Map<number, number[]>());
  const orgInfoCacheRef = useRef(new Map<number, OrgDetail>());
  // Guards which in-flight org/location request may update the info panel, so a
  // late-resolving request from a previous selection can't overwrite it.
  const infoGuardRef = useRef(new InfoRequestGuard());
  // Debounces hover-driven info loads so sweeping the cursor across a dense
  // layer doesn't fire a fetch (plus ancestor climbs) per polygon.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const orgLocationsRef = useRef(
    new Map<number, { locationId: number; lat: number; lng: number }[]>(),
  );
  const locationInfoCacheRef = useRef(new Map<number, LocationDetail>());
  // Org whose location pins are currently shown; re-fanned on zoom.
  const pinnedOrgRef = useRef<Org | null>(null);
  // Dedup in-flight org detail requests so rapid hovers share one fetch
  const orgInfoPendingRef = useRef(new Map<number, Promise<OrgDetail>>());
  const locationInfoPendingRef = useRef(
    new Map<number, Promise<LocationDetail>>(),
  );
  // True while location pins are displayed; suppresses polygon hover updates
  const pinsActiveRef = useRef(false);
  // True from a fitBounds call until its moveend; a pin pan requested meanwhile
  // waits for it (pendingPinPanRef) so it measures the settled view.
  const fitInFlightRef = useRef(false);
  const pendingPinPanRef = useRef(false);
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
  // Set by an AO search selection; consumed by the focus effect below.
  const [aoFocus, setAoFocus] = useState<{
    orgId: number;
    locationId: number;
  } | null>(null);

  // Phone bottom sheet: collapsed shows a peek of the info panel so the map
  // stays usable; expanded shows the full panel. Ignored on desktop.
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Layers actually present in the data (depth-agnostic)
  const [presentLayers, setPresentLayers] = useState<OrgType[]>(LAYER_TYPES);

  // ── info loading ─────────────────────────────────────────────────────────

  const loadOrgInfo = useCallback(async (org: Org) => {
    // selectOrg returns true on a switch to a different org; drop the previous
    // org's fallback in the same commit as the new detail, so a switch to an
    // already-cached org can't render its admin for a frame. A still-pending
    // pin fetch is invalidated by selectOrg clearing the location selection.
    if (infoGuardRef.current.selectOrg(org.id)) {
      setNearestAdminOrg(null);
      setAdminLookupInconclusive(false);
    }

    const cached = orgInfoCacheRef.current.get(org.id);
    if (cached) {
      if (infoGuardRef.current.isOrgCurrent(org.id)) {
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
      if (infoGuardRef.current.isOrgCurrent(org.id)) {
        setInfoState({ status: "loaded", org, detail });
      }
    } catch {
      orgInfoPendingRef.current.delete(org.id);
      if (infoGuardRef.current.isOrgCurrent(org.id)) {
        setInfoState({ status: "error", org });
      }
    }
  }, []);

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

    // Tapping the map hands the screen back to it. Pin markers don't bubble
    // clicks to the map, so opening a pin's details doesn't collapse the sheet.
    map.on("click", () => setSheetExpanded(false));

    // Leaflet measures its container once; re-measure when the layout settles
    // or the viewport changes (phone rotation, mobile URL bar) so tiles fill it.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // On phones the search card and info sheet float over the map, so pad fits
  // to land the focused orgs in the strip left visible between them.
  const getFitOptions = useCallback((): {
    paddingTopLeft: L.PointTuple;
    paddingBottomRight: L.PointTuple;
  } => {
    const container = mapContainerRef.current;
    if (!container || window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
      return { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24] };
    }
    const mapRect = container.getBoundingClientRect();
    const searchBottom =
      searchCardRef.current?.getBoundingClientRect().bottom ?? mapRect.top;
    const sheetTop =
      infoSheetRef.current?.getBoundingClientRect().top ?? mapRect.bottom;
    // +28 clears the tile attribution line that sits under the search card.
    const top = Math.max(0, searchBottom - mapRect.top) + 28;
    let bottom = Math.max(0, mapRect.bottom - sheetTop) + 12;
    // Keep the sheet's padding unless the strip left above it is too thin to
    // fit into — in practice only an expanded sheet, which navigation is about
    // to collapse. Short portrait screens get a shorter collapsed sheet (below)
    // so the collapsed one always leaves room.
    if (mapRect.height - top - bottom < 48) bottom = 12;
    return { paddingTopLeft: [12, top], paddingBottomRight: [12, bottom] };
  }, []);

  const fitMapTo = useCallback(
    (bounds: L.LatLngBounds) => {
      const map = mapRef.current;
      if (!map) return;
      fitInFlightRef.current = true;
      map.fitBounds(bounds, getFitOptions());
    },
    [getFitOptions],
  );

  // Fits frame the orgs' outlines, so a fanned-out pin group near an edge can
  // spill past the visible strip (or under the sheet). When an org's pins first
  // appear, nudge the map just enough to show every tap target. Re-fans on zoom
  // don't call this: those zooms are the user's, and so is the view.
  const panPinsIntoView = useCallback(() => {
    const map = mapRef.current;
    const pinLayer = pinLayerGroupRef.current;
    if (!map || !pinLayer) return;
    const points = pinLayer
      .getLayers()
      .map((layer) =>
        map.latLngToContainerPoint((layer as L.Marker).getLatLng()),
      );
    if (points.length === 0) return;
    const {
      paddingTopLeft: [left, top],
      paddingBottomRight: [right, bottom],
    } = getFitOptions();
    const size = map.getSize();
    const half = PIN_TAP_TARGET_PX / 2;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const dx = panToContain(
      Math.min(...xs) - half,
      Math.max(...xs) + half,
      left,
      size.x - right,
    );
    const dy = panToContain(
      Math.min(...ys) - half,
      Math.max(...ys) + half,
      top,
      size.y - bottom,
    );
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy]);
  }, [getFitOptions]);

  const schedulePinPan = useCallback(() => {
    if (fitInFlightRef.current) pendingPinPanRef.current = true;
    else panPinsIntoView();
  }, [panPinsIntoView]);

  const loadLocationInfo = useCallback(async (locationId: number) => {
    infoGuardRef.current.selectLocation(locationId);

    const cached = locationInfoCacheRef.current.get(locationId);
    if (cached) {
      if (infoGuardRef.current.isLocationCurrent(locationId)) {
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
      if (infoGuardRef.current.isLocationCurrent(locationId)) {
        setInfoState({ status: "loaded-location", locationId, detail });
      }
    } catch {
      locationInfoPendingRef.current.delete(locationId);
      if (infoGuardRef.current.isLocationCurrent(locationId)) {
        setInfoState({ status: "error-location", locationId });
      }
    }
  }, []);

  const showPinsForOrg = useCallback(
    (org: Org, options?: { preserveLocation?: boolean }) => {
      pinsActiveRef.current = true;
      pinnedOrgRef.current = org;
      // Switching to a new org's pins invalidates any pending location request
      // so a late-resolving one from the previous org can't populate the panel.
      // Re-fanning the current org's pins (e.g. on zoom) preserves the location selection.
      if (!options?.preserveLocation) {
        infoGuardRef.current.showPinsForOrg(org.id);
      }
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

      // The visible dot is 14px; the transparent box around it is the tap target.
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${PIN_TAP_TARGET_PX}px;height:${PIN_TAP_TARGET_PX}px;display:flex;align-items:center;justify-content:center"><div style="width:14px;height:14px;border-radius:50%;background:#B70D06;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div></div>`,
        iconSize: [PIN_TAP_TARGET_PX, PIN_TAP_TARGET_PX],
        iconAnchor: [PIN_TAP_TARGET_PX / 2, PIN_TAP_TARGET_PX / 2],
      });

      const map = mapRef.current;

      for (const group of byCoord.values()) {
        // Fan in screen pixels (not fixed degrees) so co-located pins stay
        // separated at every zoom level instead of collapsing when zoomed out.
        const offsets = computeFanOffsets(
          group.length,
          fanRadiusForTargets(
            group.length,
            PIN_TAP_TARGET_PX,
            PIN_FAN_RADIUS_PX,
          ),
        );
        group.forEach((loc, i) => {
          let latlng = L.latLng(loc.lat, loc.lng);
          if (group.length > 1 && map) {
            const offset = offsets[i]!;
            const base = map.latLngToLayerPoint(latlng);
            latlng = map.layerPointToLatLng(
              base.add(L.point(offset.dx, offset.dy)),
            );
          }
          // Keep pin taps from reaching the map's collapse-the-sheet handler.
          // (Leaflet's marker default, made explicit since the sheet relies on it.)
          const marker = L.marker(latlng, { icon, bubblingMouseEvents: false });

          marker.on("mouseover", () => {
            void loadLocationInfo(loc.locationId);
          });
          marker.on("click", () => {
            void loadLocationInfo(loc.locationId);
            // Phones have no hover: a tapped pin's details are the point.
            setSheetExpanded(true);
          });

          marker.addTo(pinLayer);
        });
      }
    },
    [loadLocationInfo],
  );

  // Re-fan the pins on zoom so their pixel spacing stays constant on screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onZoomEnd = () => {
      if (pinsActiveRef.current && pinnedOrgRef.current) {
        showPinsForOrg(pinnedOrgRef.current, { preserveLocation: true });
      }
    };
    // zoomend (and the re-fan above) fires before moveend, so a pan waiting on
    // a fit measures the re-fanned pins.
    const onMoveEnd = () => {
      fitInFlightRef.current = false;
      if (pendingPinPanRef.current) {
        pendingPinPanRef.current = false;
        panPinsIntoView();
      }
    };
    map.on("zoomend", onZoomEnd);
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("zoomend", onZoomEnd);
      map.off("moveend", onMoveEnd);
    };
  }, [isLoaded, showPinsForOrg, panPinsIntoView]);

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
      // Show the newly focused orgs rather than leaving the sheet over them.
      setSheetExpanded(false);

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
      if (bounds) fitMapTo(bounds);

      void loadOrgInfo(org);
    },
    [loadOrgInfo, fitMapTo],
  );

  const navigateToAo = useCallback(
    (ao: AoSearchResult) => {
      const region = orgByIdRef.current.get(ao.regionId);
      if (!region) return false;
      navigateToOrg(region);
      // A fresh object each call re-triggers the focus effect below, even when
      // the region view doesn't change (same region, different AO).
      setAoFocus({ orgId: ao.regionId, locationId: ao.locationId });
      return true;
    },
    [navigateToOrg],
  );

  const navigateViaLevelButton = useCallback(
    (level: OrgType) => {
      setSheetExpanded(false);
      pinsActiveRef.current = false;
      pinnedOrgRef.current = null;
      infoGuardRef.current.clearPins();
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
      setSheetExpanded(false);
      pinsActiveRef.current = false;
      pinnedOrgRef.current = null;
      infoGuardRef.current.clearPins();
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
    pinnedOrgRef.current = null;
    infoGuardRef.current.clearPins();
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
          // Leaf layer: show location pins for this org. Load its info too —
          // on touch there is no hover to have loaded it already.
          writeUrlState(currentLevel, org.id);
          void loadOrgInfo(org);
          showPinsForOrg(org);
          schedulePinPan();
          return;
        }
        navigateToOrg(org);
      });

      polygon.addTo(layerGroup);
    }

    if (allLatLngs.length > 0) {
      fitMapTo(L.latLngBounds(allLatLngs));
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
    schedulePinPan,
    fitMapTo,
  ]);

  // Keep the current (last) crumb in view when the phone breadcrumb scrolls.
  useEffect(() => {
    const el = breadcrumbRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [selectedPath]);

  // Likewise the active layer button, when the layer row scrolls sideways.
  useEffect(() => {
    layerNavRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [currentLevel]);

  // After an AO search selection, once the region view has (re)rendered, show
  // its pins and open the selected AO's location. Declared after the polygon
  // render effect so it runs second — its pins survive that effect's clear.
  useEffect(() => {
    if (!aoFocus || !isLoaded) return;
    const org = orgByIdRef.current.get(aoFocus.orgId);
    if (!org) return;
    showPinsForOrg(org);
    schedulePinPan();
    void loadLocationInfo(aoFocus.locationId);
  }, [aoFocus, isLoaded, showPinsForOrg, schedulePinPan, loadLocationInfo]);

  // ── nearest parent admin lookup (for empty-roles message) ───────────────

  useEffect(() => {
    if (infoState.status !== "loaded" || infoState.detail.roles.length > 0) {
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
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the effect cleanup sets `cancelled` while this awaits
            if (!cancelled) orgInfoCacheRef.current.set(ancestor.id, detail);
          } catch {
            // Couldn't check this ancestor — distinct from "it has no admins".
            hadFailure = true;
            continue;
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the effect cleanup sets `cancelled` while this awaits
        if (cancelled) return;

        const admins = detail.roles.filter((r) =>
          r.title.toLowerCase().includes("admin"),
        );
        if (admins.length > 0) {
          // The guard flips synchronously on switch (before any await
          // resolves), so a stale climb can't overwrite a newer org's panel.
          if (infoGuardRef.current.isOrgCurrent(org.id)) {
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
      if (!cancelled && infoGuardRef.current.isOrgCurrent(org.id)) {
        setAdminLookupInconclusive(hadFailure);
      }
    }

    void climb().catch(() => {
      // An unexpected shape must surface as inconclusive, not a false "none".
      if (!cancelled && infoGuardRef.current.isOrgCurrent(org.id)) {
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
    <div className="flex h-dvh flex-col bg-[#f6f3ea]">
      {/* Header. Landscape phones get the side-by-side layout (see `org-wide`)
          but are short, so the header collapses to one row — title, then the
          layer buttons and breadcrumb sharing the rest, each scrolling
          sideways — and the gutters tighten to leave map room. */}
      <header className="org-wide:flex-row org-wide:items-center org-wide:justify-between org-wide:gap-8 org-wide:px-6 org-wide:py-4 org-wide:[@media(max-height:500px)]:gap-4 org-wide:[@media(max-height:500px)]:py-2 flex flex-col gap-2 bg-[#0b0d12] px-3 py-2 text-[#f6f3ea]">
        <div className="org-wide:[@media(max-height:500px)]:shrink-0">
          <h1 className="org-wide:text-lg org-wide:[@media(max-height:500px)]:text-base org-wide:[@media(max-height:500px)]:whitespace-nowrap text-base font-bold">
            F3 Geographic Directory
          </h1>
          <div className="org-wide:block org-wide:[@media(max-height:500px)]:hidden hidden text-xs text-[rgba(215,38,56,0.85)]">
            {presentLayers
              .slice()
              .reverse()
              .map((t) => orgTypeDisplay[t].pluralLabel)
              .join(" → ")}{" "}
            → {orgTypeDisplay.ao.pluralLabel}
          </div>
        </div>

        {/* Layer buttons — generated from data, depth-agnostic. One swipeable
            row on phones instead of wrapping onto extra lines. */}
        <nav
          ref={layerNavRef}
          className="org-wide:mx-0 org-wide:flex-wrap org-wide:overflow-visible org-wide:px-0 org-wide:[@media(max-height:500px)]:min-w-0 org-wide:[@media(max-height:500px)]:flex-1 org-wide:[@media(max-height:500px)]:flex-nowrap org-wide:[@media(max-height:500px)]:overflow-x-auto -mx-3 flex gap-2 overflow-x-auto px-3"
          aria-label="Map layers"
        >
          {presentLayers
            .slice()
            .reverse()
            .map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => navigateViaLevelButton(layer)}
                aria-pressed={currentLevel === layer}
                className={`org-wide:px-4 org-wide:py-2 org-wide:[@media(max-height:500px)]:py-1 shrink-0 rounded-sm border px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition-all ${
                  currentLevel === layer
                    ? "border-[#B70D06] bg-[#B70D06] text-[#1a1a1a]"
                    : "border-[#2c3648] bg-[#151a24] text-[#f8f4ea] hover:border-[#3b4a62] hover:bg-[#233046]"
                }`}
              >
                {orgTypeDisplay[layer].pluralLabel}
              </button>
            ))}
        </nav>

        {/* Breadcrumb — a single scrolling line on phones. Capped on short
            landscape screens so it can't squeeze the layer buttons out. */}
        <nav
          ref={breadcrumbRef}
          className="org-wide:flex-none org-wide:overflow-visible org-wide:whitespace-normal org-wide:[@media(max-height:500px)]:max-w-[40%] org-wide:[@media(max-height:500px)]:min-w-0 org-wide:[@media(max-height:500px)]:flex-initial org-wide:[@media(max-height:500px)]:overflow-x-auto org-wide:[@media(max-height:500px)]:whitespace-nowrap overflow-x-auto text-sm whitespace-nowrap"
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

      {/* Main content. Phones: full-bleed map with the search card floating on
          top and the info panel as a bottom sheet. Desktop: map + sidebar. */}
      <main className="org-wide:grid org-wide:grid-cols-[1fr_320px] org-wide:gap-4 org-wide:p-4 org-wide:[@media(max-height:500px)]:gap-2 org-wide:[@media(max-height:500px)]:p-2 relative min-h-0 flex-1 overflow-hidden">
        {/* Map. `isolate` keeps Leaflet's high pane/control z-indexes from
            stacking above the phone overlays. */}
        <div className="org-wide:relative org-wide:inset-auto org-wide:rounded-2xl org-wide:shadow-xl absolute inset-0 isolate overflow-hidden">
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
          {/* Phones pinch to zoom, and the +/- control would sit under the
              floating search card. The bottom sheet would hide the tile
              attribution (required by OSM/CARTO), so on phones it moves to
              just below the search card. */}
          <div
            ref={mapContainerRef}
            className="org-overlay:[&_.leaflet-bottom.leaflet-right]:top-[4.25rem] org-overlay:[&_.leaflet-bottom.leaflet-right]:bottom-auto! org-overlay:[&_.leaflet-control-zoom]:hidden h-full w-full"
          />
        </div>

        {/* Sidebar. `contents` on phones lets its two cards position against
            <main> as overlays. */}
        <aside className="org-wide:flex org-wide:flex-col org-wide:gap-3 org-wide:overflow-y-auto contents">
          {/* z-20: above the sheet so search results aren't covered by it. */}
          <div
            ref={searchCardRef}
            className="org-wide:static org-wide:p-4 absolute inset-x-2 top-2 z-20 rounded-2xl bg-white p-2 shadow-md"
          >
            <SearchBox
              presentLayers={presentLayers}
              getResults={getSearchResults}
              onSelect={navigateToOrg}
              onSelectAo={navigateToAo}
              disabled={!isLoaded}
            />
          </div>
          <section
            ref={infoSheetRef}
            aria-label="Details"
            className="org-wide:static org-wide:max-h-none org-wide:flex-1 org-wide:rounded-2xl org-wide:shadow-md absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-2xl bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
          >
            <button
              type="button"
              onClick={() => setSheetExpanded((v) => !v)}
              aria-expanded={sheetExpanded}
              aria-controls="org-info-content"
              aria-label={sheetExpanded ? "Collapse details" : "Expand details"}
              className="org-wide:hidden flex min-h-11 w-full shrink-0 items-center justify-center"
            >
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
            </button>
            <div
              id="org-info-content"
              className={`org-wide:p-5 flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5 ${
                sheetExpanded
                  ? ""
                  : "org-overlay:max-h-32 org-overlay:[@media(max-height:640px)]:max-h-16"
              }`}
            >
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
          </section>
        </aside>
      </main>
    </div>
  );
}
