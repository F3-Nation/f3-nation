"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import type {
  LayerFilters,
  LeaderRow,
  SortColumn,
  SortState,
} from "../_lib/leadership-table";
import type { Org, OrgType } from "../_lib/types";
import { fetchLeadership } from "../_lib/api";
import { fuzzyScore } from "../_lib/geo-utils";
import {
  downloadCsv,
  leadershipCsv,
  leadershipCsvFilename,
  NO_PAX_LISTED,
  NO_POSITIONS_FILLED,
} from "../_lib/leadership-csv";
import {
  buildRows,
  checkedOrgIds,
  checkOrg,
  clearLayerFilter,
  filterRows,
  filtersFromOrgIds,
  getLayerOptions,
  getPresentLayers,
  isEmptyOrgRow,
  mapFocusOrgId,
  nextSort,
  sortRows,
  toggleLayerFilter,
} from "../_lib/leadership-table";
import {
  PHONE_PORTRAIT_MEDIA_QUERY,
  useMediaQuery,
} from "../_lib/use-media-query";
import { writeTableUrlState } from "../_lib/url-state";
import { FilterMultiSelect } from "./filter-multi-select";
import { Avatar, EmptyLabel, KindTag } from "./leader-parts";
import { OrgAccordion } from "./org-accordion";
import { SearchBox } from "./search-box";

const COLUMNS: { column: SortColumn; label: string }[] = [
  { column: "org", label: "Org" },
  { column: "pax", label: "PAX" },
  { column: "title", label: "Position/Role" },
];

interface TableData {
  orgById: Map<number, Org>;
  layers: OrgType[];
  rows: LeaderRow[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: TableData };

function OrgCell({ org }: { org: Org }) {
  return (
    <td className="px-4 py-2 whitespace-nowrap">
      {org.name}{" "}
      <span className="text-muted-foreground">
        ({orgTypeDisplay[org.orgType].label})
      </span>
    </td>
  );
}

interface OrgTableProps {
  viewSwitcher?: ReactNode;
  /** Orgs to check once the data loads (from the URL or the Map). */
  initialOrgIds?: readonly number[];
  /** Told the org the Map should open on whenever the filters change. */
  onMapFocusChange?: (orgId: number | null) => void;
}

export function OrgTable({
  viewSwitcher,
  initialOrgIds = [],
  onMapFocusChange,
}: OrgTableProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filters, setFilters] = useState<LayerFilters>({});
  const [sort, setSort] = useState<SortState | null>(null);
  // Portrait phones get an accordion of orgs instead of the table.
  const phonePortrait = useMediaQuery(PHONE_PORTRAIT_MEDIA_QUERY);

  useEffect(() => {
    let cancelled = false;
    fetchLeadership()
      .then(({ orgs, leaders }) => {
        if (cancelled) return;
        // Every active org, not just those with locations (the map's chart),
        // so leaders at orgs nobody meets at yet are still listed.
        const orgById = new Map(orgs.map((org) => [org.id, org]));
        const layers = getPresentLayers(orgById);
        setFilters(filtersFromOrgIds(initialOrgIds, layers, orgById));
        setState({
          status: "loaded",
          data: { orgById, layers, rows: buildRows(leaders, orgById, layers) },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
    // Load once; later initialOrgIds come with a remount (a view switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === "loaded" ? state.data : null;

  // Keep the URL and the Map's landing org in step with the filters, once the
  // filters have been restored (writing earlier would wipe the URL's orgs).
  useEffect(() => {
    if (!data) return;
    writeTableUrlState(checkedOrgIds(filters, data.layers));
    onMapFocusChange?.(mapFocusOrgId(filters, data.layers));
  }, [data, filters, onMapFocusChange]);

  const visibleRows = useMemo(
    () =>
      data
        ? sortRows(
            filterRows(data.rows, filters, data.layers, data.orgById),
            sort,
          )
        : [],
    [data, filters, sort],
  );

  const getSearchResults = useCallback(
    (query: string): Org[] => {
      if (!data) return [];
      return [...data.orgById.values()]
        .filter((o) => data.layers.includes(o.orgType))
        .map((org) => ({ org, score: fuzzyScore(query, org.name) }))
        .filter((x): x is { org: Org; score: number } => x.score != null)
        .sort(
          (a, b) => b.score - a.score || a.org.name.localeCompare(b.org.name),
        )
        .slice(0, 8)
        .map((x) => x.org);
    },
    [data],
  );

  const selectOrg = useCallback(
    (org: Org) => {
      if (data) setFilters((f) => checkOrg(f, org, data.layers, data.orgById));
    },
    [data],
  );

  const emptyOrgCount = visibleRows.filter(isEmptyOrgRow).length;
  const positionCount = visibleRows.length - emptyOrgCount;

  const layers = useMemo(() => data?.layers ?? [], [data]);
  const hasFilters = layers.some((l) => (filters[l]?.length ?? 0) > 0);
  // Search lists layers leaf → root, like the map.
  const searchLayers = useMemo(() => layers.slice().reverse(), [layers]);

  return (
    <div className="flex min-h-dvh flex-col bg-[#f6f3ea]">
      <header className="flex flex-col gap-1 bg-[#0b0d12] px-3 py-2 text-[#f6f3ea] sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-bold sm:text-lg">
            F3 Geographic Directory
          </h1>
          {viewSwitcher}
        </div>
        <div className="hidden text-xs text-[rgba(215,38,56,0.85)] sm:block">
          Positions &amp; roles by{" "}
          {layers.map((t) => orgTypeDisplay[t].label).join(", ")}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
        <section
          aria-label="Filters"
          className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-md sm:p-4"
        >
          <div className="max-w-md">
            <SearchBox
              presentLayers={searchLayers}
              getResults={getSearchResults}
              onSelect={selectOrg}
              disabled={!data}
            />
          </div>
          {/* Stacked on portrait phones and tablets, a row elsewhere; keyed to the
              same split as the accordion so the two can't disagree. */}
          <div className="org-wide:flex org-wide:flex-wrap grid grid-cols-1 gap-3">
            {data &&
              layers.map((layer) => {
                const options = getLayerOptions(
                  layer,
                  filters,
                  layers,
                  data.orgById,
                );
                return (
                  <FilterMultiSelect
                    key={layer}
                    label={orgTypeDisplay[layer].label}
                    options={options}
                    selectedIds={filters[layer] ?? []}
                    onToggle={(orgId) =>
                      setFilters((f) =>
                        toggleLayerFilter(f, orgId, layers, data.orgById),
                      )
                    }
                    onClear={() =>
                      setFilters((f) => clearLayerFilter(f, layer, layers))
                    }
                  />
                );
              })}
            {hasFilters && (
              <button
                type="button"
                onClick={() => setFilters({})}
                className="self-end rounded-lg px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
              >
                Clear filters
              </button>
            )}
          </div>
        </section>

        <section
          aria-label="Positions and roles"
          className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white shadow-md"
        >
          {state.status === "loading" && (
            <p className="p-6 text-sm text-muted-foreground">
              Loading positions and roles…
            </p>
          )}
          {state.status === "error" && (
            <p className="p-6 text-sm text-muted-foreground">
              Failed to load: {state.message}
            </p>
          )}
          {data && (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {positionCount === 1
                    ? "1 position or role"
                    : `${positionCount} positions and roles`}
                  {emptyOrgCount > 0 &&
                    ` · ${emptyOrgCount} ${
                      emptyOrgCount === 1 ? "org" : "orgs"
                    } with no positions filled`}
                </p>
                {/* Not offered in the portrait-phone accordion. */}
                {!phonePortrait && (
                  <button
                    type="button"
                    disabled={visibleRows.length === 0}
                    onClick={() =>
                      downloadCsv(
                        leadershipCsv(visibleRows),
                        leadershipCsvFilename(new Date()),
                      )
                    }
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download CSV
                  </button>
                )}
              </div>
              {visibleRows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No positions or roles match these filters.
                </p>
              ) : phonePortrait ? (
                <OrgAccordion
                  key={checkedOrgIds(filters, layers).join(",")}
                  rows={visibleRows}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs tracking-widest text-muted-foreground uppercase">
                      <tr>
                        {COLUMNS.map(({ column, label }) => {
                          const direction =
                            sort?.column === column ? sort.direction : null;
                          return (
                            <th
                              key={column}
                              scope="col"
                              aria-sort={
                                direction === "asc"
                                  ? "ascending"
                                  : direction === "desc"
                                    ? "descending"
                                    : "none"
                              }
                              className="px-4 py-2 font-medium"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setSort((cur) => nextSort(cur, column))
                                }
                                className="inline-flex items-center gap-1 tracking-widest uppercase hover:text-foreground"
                              >
                                {label}
                                <span
                                  aria-hidden="true"
                                  className={`w-3 text-center ${
                                    direction
                                      ? "text-foreground"
                                      : "text-muted-foreground/60"
                                  }`}
                                >
                                  {direction === "asc"
                                    ? "▲"
                                    : direction === "desc"
                                      ? "▼"
                                      : "↕"}
                                </span>
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) =>
                        isEmptyOrgRow(row) ? (
                          <tr
                            key={row.key}
                            data-empty-org=""
                            className="border-t border-border bg-[#faf7ef] text-muted-foreground"
                          >
                            <OrgCell org={row.org} />
                            <th scope="row" className="px-4 py-2 font-normal">
                              <span className="flex items-center gap-3">
                                <span
                                  aria-hidden="true"
                                  className="h-9 w-9 shrink-0 rounded-lg border border-dashed border-[#c9bfa6]"
                                />
                                <EmptyLabel>{NO_PAX_LISTED}</EmptyLabel>
                              </span>
                            </th>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <EmptyLabel>{NO_POSITIONS_FILLED}</EmptyLabel>
                            </td>
                          </tr>
                        ) : (
                          <tr key={row.key} className="border-t border-border">
                            <OrgCell org={row.org} />
                            <th
                              scope="row"
                              className="px-4 py-2 font-semibold text-foreground"
                            >
                              <span className="flex items-center gap-3">
                                <Avatar row={row} />
                                <span className="whitespace-nowrap">
                                  {row.f3Name ?? "Unknown"}
                                  {row.homeRegionName && (
                                    <span className="font-normal text-muted-foreground">
                                      {" "}
                                      ({row.homeRegionName})
                                    </span>
                                  )}
                                </span>
                              </span>
                            </th>
                            <td className="px-4 py-2 whitespace-nowrap">
                              {row.title}
                              <KindTag kind={row.kind} />
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
