"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import type { Org, OrgDetail, OrgMetrics, OrgType, Point } from "../_lib/types";
import { buildOrgHierarchy, LAYER_TYPES, orgTypeRank } from "../_lib/org-chart";
import {
  convexHull,
  createCircleBuffer,
  createStarPolygon,
  dedupePoints,
  fuzzyScore,
  polygonAreaSqMi,
} from "../_lib/geo-utils";
import { fetchOrgById, fetchOrgChart } from "../_lib/api";
import {
  readLevelFromUrl,
  readOrgIdFromUrl,
  writeUrlState,
} from "../_lib/url-state";
import type { NearestAdminOrg } from "./org-info-panel";
import { OrgInfoPanel } from "./org-info-panel";
import { SearchBox } from "./search-box";

// ─── types local to this component ───────────────────────────────────────────

type InfoState =
  | { status: "idle" }
  | { status: "loading"; org: Org }
  | { status: "loaded"; org: Org; detail: OrgDetail }
  | { status: "error"; org: Org };

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

function isInternationalSector(org: Org): boolean {
  return (
    org.orgType === "sector" &&
    org.name.trim().toLowerCase() === "international"
  );
}

function isGeneralInternationalArea(org: Org): boolean {
  return (
    org.orgType === "area" &&
    org.name.trim().toLowerCase() === "general international area"
  );
}

function getDescendants(
  orgId: number,
  childrenByParent: Map<number, Org[]>,
  cache: Map<number, number[]>,
): number[] {
  const cached = cache.get(orgId);
  if (cached) return cached;
  const children = childrenByParent.get(orgId) ?? [];
  const ids = [
    orgId,
    ...children.flatMap((c) => getDescendants(c.id, childrenByParent, cache)),
  ];
  cache.set(orgId, ids);
  return ids;
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

function getOrgPath(orgId: number, orgById: Map<number, Org>): Org[] {
  const path: Org[] = [];
  let current = orgById.get(orgId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? orgById.get(current.parentId) : undefined;
  }
  return path;
}

/** Orgs to show at the current level given the navigation state. */
function getLevelOrgs(
  level: OrgType,
  selectedPath: Org[],
  orgById: Map<number, Org>,
  childrenByParent: Map<number, Org[]>,
  descendantCache: Map<number, number[]>,
): Org[] {
  if (
    !selectedPath.length ||
    orgTypeRank(level) >=
      orgTypeRank(selectedPath[selectedPath.length - 1]!.orgType)
  ) {
    // Top-level or wider than current selection: show all of this type
    return [...orgById.values()].filter((o) => o.orgType === level);
  }

  const parent = selectedPath[selectedPath.length - 1]!;

  // International sector: show all region descendants (no geographic boundary)
  if (isInternationalSector(parent) && level === "region") {
    const ids = new Set(
      getDescendants(parent.id, childrenByParent, descendantCache),
    );
    return [...orgById.values()].filter(
      (o) => o.orgType === "region" && ids.has(o.id),
    );
  }

  // If we navigated into a region, show sibling regions
  if (level === "region" && parent.orgType === "region") {
    return [...orgById.values()].filter(
      (o) => o.orgType === "region" && o.parentId === parent.parentId,
    );
  }

  return [...orgById.values()].filter(
    (o) => o.orgType === level && o.parentId === parent.id,
  );
}

/**
 * Depth-agnostic: compute path + level when navigating to an org.
 * LAYER_TYPES is ordered leaf→root. A lower index = more specific.
 */
function pathForNavigatingTo(
  org: Org,
  orgById: Map<number, Org>,
): { path: Org[]; level: OrgType } {
  const fullPath = getOrgPath(org.id, orgById);
  const nonNation = fullPath.filter((o) => o.orgType !== "nation");
  const orgLayerIdx = LAYER_TYPES.indexOf(org.orgType);

  if (orgLayerIdx === -1) {
    // Not a navigable layer type; show context without this org
    return { path: nonNation.slice(0, -1), level: org.orgType };
  }

  if (orgLayerIdx === 0) {
    // Most-specific layer (e.g. region): view-only, keep ancestors in path
    const pathWithoutLeaf = nonNation.filter(
      (o) => LAYER_TYPES.indexOf(o.orgType) > orgLayerIdx,
    );
    return { path: pathWithoutLeaf, level: LAYER_TYPES[0]! };
  }

  // Drill: next layer is one step more specific (lower index)
  const nextLevel = LAYER_TYPES[orgLayerIdx - 1]!;
  const pathToOrg = nonNation.filter(
    (o) => LAYER_TYPES.indexOf(o.orgType) >= orgLayerIdx,
  );
  return { path: pathToOrg, level: nextLevel };
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
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState<OrgType>("sector");
  const [selectedPath, setSelectedPath] = useState<Org[]>([]);
  const [infoState, setInfoState] = useState<InfoState>({ status: "idle" });
  const [nearestAdminOrg, setNearestAdminOrg] =
    useState<NearestAdminOrg | null>(null);

  // Layers actually present in the data (depth-agnostic)
  const [presentLayers, setPresentLayers] = useState<OrgType[]>(LAYER_TYPES);

  // ── initial data load ────────────────────────────────────────────────────

  useEffect(() => {
    fetchOrgChart()
      .then((items) => {
        const { orgById, childrenByParent, pointsById, metricsById } =
          buildOrgHierarchy(items);
        orgByIdRef.current = orgById;
        childrenByParentRef.current = childrenByParent;
        pointsByIdRef.current = pointsById;
        metricsByIdRef.current = metricsById;
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
            const { path, level } = pathForNavigatingTo(urlOrg, orgById);
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

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // ── info loading ─────────────────────────────────────────────────────────

  const loadOrgInfo = useCallback(async (org: Org) => {
    activeInfoOrgIdRef.current = org.id;

    const cached = orgInfoCacheRef.current.get(org.id);
    if (cached) {
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "loaded", org, detail: cached });
      }
      return;
    }

    setInfoState({ status: "loading", org });

    try {
      const detail = await fetchOrgById(org.id);
      orgInfoCacheRef.current.set(org.id, detail);
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "loaded", org, detail });
      }
    } catch {
      if (activeInfoOrgIdRef.current === org.id) {
        setInfoState({ status: "error", org });
      }
    }
  }, []);

  // ── navigation helpers ───────────────────────────────────────────────────

  const navigateToOrg = useCallback(
    (org: Org) => {
      const { path, level } = pathForNavigatingTo(org, orgByIdRef.current);
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
              // Drill one step more specific: lower index in LAYER_TYPES
              const idx = LAYER_TYPES.indexOf(lastOrg.orgType);
              return idx > 0 ? LAYER_TYPES[idx - 1]! : lastOrg.orgType;
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
        if (org.orgType === "region") writeUrlState(currentLevel, org.id);
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          void loadOrgInfo(org);
        }, 200);
      });

      polygon.on("mouseout", () => {
        polygon.setStyle({ weight: 2, fillOpacity: 0.18 });
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
      });

      polygon.on("click", () => {
        // Most-specific layer is view-only: hover for info, no drill-down
        if (org.orgType === LAYER_TYPES[0]) return;
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
  }, [isLoaded, currentLevel, selectedPath, loadOrgInfo, navigateToOrg]);

  // ── nearest parent admin lookup (for empty-roles message) ───────────────

  useEffect(() => {
    if (
      infoState.status !== "loaded" ||
      (infoState.detail.roles?.length ?? 0) > 0
    ) {
      setNearestAdminOrg(null);
      return;
    }

    const { org } = infoState;
    let cancelled = false;

    // Climb every ancestor, nation included: if the nation is the only level
    // with admins we still want to surface it rather than "No admins listed".
    const ancestors = getOrgPath(org.id, orgByIdRef.current)
      .filter((o) => o.id !== org.id)
      .reverse(); // nearest first

    async function climb() {
      for (const ancestor of ancestors) {
        if (cancelled) return;

        let detail = orgInfoCacheRef.current.get(ancestor.id);
        if (!detail) {
          try {
            detail = await fetchOrgById(ancestor.id);
            if (!cancelled) orgInfoCacheRef.current.set(ancestor.id, detail);
          } catch (err) {
            // A failed lookup ("couldn't check") is not the same as "no admins".
            // Warn so it's debuggable, then try the next ancestor.
            console.warn(
              `[org-chart] nearest-admin lookup failed for org ${ancestor.id}`,
              err,
            );
            continue;
          }
        }

        if (cancelled) return;

        const admins = (detail.roles ?? []).filter(
          (r) => r.title?.toLowerCase().includes("admin") ?? false,
        );
        if (admins.length > 0) {
          setNearestAdminOrg({
            name: ancestor.name,
            orgType: ancestor.orgType,
            adminNames: admins.map((a) => a.f3Name ?? "Unknown"),
          });
          return;
        }
        // No admins here — keep climbing
      }

      if (!cancelled) setNearestAdminOrg(null);
    }

    void climb().catch((err: unknown) => {
      // An unexpected shape (e.g. a null title slipping past the guards) must
      // not become a silent unhandled rejection.
      console.warn("[org-chart] nearest-admin climb failed", err);
      if (!cancelled) setNearestAdminOrg(null);
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

  const infoOrg = infoState.status !== "idle" ? infoState.org : undefined;

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
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
