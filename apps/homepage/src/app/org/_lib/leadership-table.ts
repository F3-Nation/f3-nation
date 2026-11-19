import type { LeaderEntry, Org, OrgType } from "./types";
import { LAYER_TYPES, orgTypeRank } from "./org-chart";

/** One table row: a person holding a position or role at an org. */
export interface LeaderRow extends LeaderEntry {
  key: string;
  org: Org;
}

/**
 * A placeholder row for an org in the filtered scope that has nobody in a
 * position or role, so empty orgs show up instead of silently missing.
 */
export interface EmptyOrgRow {
  key: string;
  org: Org;
  empty: true;
}

export type TableRow = LeaderRow | EmptyOrgRow;

export function isEmptyOrgRow(row: TableRow): row is EmptyOrgRow {
  return "empty" in row;
}

const rowTitle = (row: TableRow) => (isEmptyOrgRow(row) ? "" : row.title);
const rowName = (row: TableRow) =>
  isEmptyOrgRow(row) ? "" : (row.f3Name ?? "");

/** The checked orgs per layer; a missing or empty layer means "All". */
export type LayerFilters = Partial<Record<OrgType, number[]>>;

export type SortColumn = "org" | "pax" | "title";
export interface SortState {
  column: SortColumn;
  direction: "asc" | "desc";
}

/** Navigable layers present in the data, broadest first. */
export function getPresentLayers(orgById: Map<number, Org>): OrgType[] {
  const present = new Set<OrgType>();
  for (const org of orgById.values()) present.add(org.orgType);
  return LAYER_TYPES.filter((t) => present.has(t)).reverse();
}

function parentOf(org: Org, orgById: Map<number, Org>): Org | undefined {
  return org.parentId == null ? undefined : orgById.get(org.parentId);
}

/** True when `org` is `ancestorId` or sits anywhere beneath it. */
export function isWithin(
  org: Org,
  ancestorId: number,
  orgById: Map<number, Org>,
): boolean {
  const seen = new Set<number>();
  for (
    let cur: Org | undefined = org;
    cur && !seen.has(cur.id);
    cur = parentOf(cur, orgById)
  ) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
  }
  return false;
}

function ancestors(org: Org, orgById: Map<number, Org>): Org[] {
  const result: Org[] = [];
  const seen = new Set<number>([org.id]);
  for (
    let cur = parentOf(org, orgById);
    cur && !seen.has(cur.id);
    cur = parentOf(cur, orgById)
  ) {
    result.push(cur);
    seen.add(cur.id);
  }
  return result;
}

function compareDefault(a: TableRow, b: TableRow): number {
  return (
    orgTypeRank(b.org.orgType) - orgTypeRank(a.org.orgType) ||
    a.org.name.localeCompare(b.org.name) ||
    // Keep two same-named orgs' rows apart.
    a.org.id - b.org.id ||
    rowTitle(a).localeCompare(rowTitle(b)) ||
    rowName(a).localeCompare(rowName(b))
  );
}

/**
 * Rows for every leader at an org in one of `layers`, in the default order:
 * broadest level first, then org name (and id), title, and F3 name. Leaders
 * at orgs outside `orgById` or `layers` (AOs, nation, unknown) are dropped.
 */
export function buildRows(
  leaders: LeaderEntry[],
  orgById: Map<number, Org>,
  layers: readonly OrgType[],
): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const leader of leaders) {
    const org = orgById.get(leader.orgId);
    if (!org || !layers.includes(org.orgType)) continue;
    rows.push({
      ...leader,
      org,
      key: `${leader.kind}-${leader.id}-${leader.orgId}-${leader.userId}`,
    });
  }
  return rows.sort(compareDefault);
}

/**
 * Rows sorted by a column; ties (and no sort) keep the default order. Sorting
 * by PAX or Position/Role keeps empty-org rows last in either direction.
 */
export function sortRows<Row extends TableRow>(
  rows: Row[],
  sort: SortState | null,
): Row[] {
  if (!sort) return rows;
  const key = (row: TableRow) =>
    sort.column === "org"
      ? row.org.name
      : sort.column === "pax"
        ? rowName(row)
        : rowTitle(row);
  const emptyLast = (row: TableRow) =>
    sort.column !== "org" && isEmptyOrgRow(row) ? 1 : 0;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      emptyLast(a) - emptyLast(b) ||
      sign * key(a).localeCompare(key(b), undefined, { sensitivity: "base" }) ||
      compareDefault(a, b),
  );
}

/** Next sort after clicking `column`'s header: asc → desc → default. */
export function nextSort(
  current: SortState | null,
  column: SortColumn,
): SortState | null {
  if (current?.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/**
 * The orgs that define what is in view: each checked org (in `layers`) that
 * has no checked descendant in a narrower one of those layers.
 */
export function getScopeOrgs(
  filters: LayerFilters,
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): Org[] {
  const checked = layers.flatMap((l) =>
    (filters[l] ?? []).flatMap((id) => orgById.get(id) ?? []),
  );
  return checked.filter(
    (org) =>
      !checked.some(
        (other) => other !== org && isWithin(other, org.id, orgById),
      ),
  );
}

function inScope(org: Org, scope: Org[], orgById: Map<number, Org>): boolean {
  return scope.length === 0 || scope.some((s) => isWithin(org, s.id, orgById));
}

/**
 * Filter options for `layer`: its orgs inside the orgs checked in broader
 * filters, sorted by name.
 */
export function getLayerOptions(
  layer: OrgType,
  filters: LayerFilters,
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): Org[] {
  const scope = getScopeOrgs(
    filters,
    layers.slice(0, layers.indexOf(layer)),
    orgById,
  );
  return [...orgById.values()]
    .filter((o) => o.orgType === layer && inScope(o, scope, orgById))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check or uncheck one org. Checking also checks its ancestors in broader
 * filters; unchecking also unchecks narrower choices inside it.
 */
export function toggleLayerFilter(
  filters: LayerFilters,
  orgId: number,
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): LayerFilters {
  const org = orgById.get(orgId);
  if (!org || !layers.includes(org.orgType)) return filters;
  const next: LayerFilters = {};
  for (const l of layers) next[l] = [...(filters[l] ?? [])];

  if (next[org.orgType]!.includes(org.id)) {
    for (const l of layers) {
      next[l] = next[l]!.filter((id) => {
        const picked = orgById.get(id);
        return !picked || !isWithin(picked, org.id, orgById);
      });
    }
  } else {
    for (const o of [org, ...ancestors(org, orgById)]) {
      const list = next[o.orgType];
      if (list && !list.includes(o.id)) list.push(o.id);
    }
  }
  for (const l of layers) if (next[l]!.length === 0) delete next[l];
  return next;
}

/** Uncheck everything in `layer` and in every narrower filter. */
export function clearLayerFilter(
  filters: LayerFilters,
  layer: OrgType,
  layers: readonly OrgType[],
): LayerFilters {
  const next: LayerFilters = {};
  for (const l of layers.slice(0, layers.indexOf(layer))) {
    if (filters[l]?.length) next[l] = filters[l];
  }
  return next;
}

/** Filters with `org` checked, as if it were checked in its own filter. */
export function checkOrg(
  filters: LayerFilters,
  org: Org,
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): LayerFilters {
  return filters[org.orgType]?.includes(org.id)
    ? filters
    : toggleLayerFilter(filters, org.id, layers, orgById);
}

/**
 * The rows in view. With filters set: rows at each scope org and the orgs
 * beneath it. With none: only rows at the broadest layer's orgs (e.g. sector
 * positions, without their children). Every org in view with no leader row
 * gets an {@link EmptyOrgRow}, in its default-order place.
 */
export function filterRows(
  rows: LeaderRow[],
  filters: LayerFilters,
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): TableRow[] {
  const scope = getScopeOrgs(filters, layers, orgById);
  const inView = (org: Org) =>
    scope.length === 0
      ? org.orgType === layers[0]
      : layers.includes(org.orgType) && inScope(org, scope, orgById);
  const shown = rows.filter((row) => inView(row.org));
  const filled = new Set(shown.map((row) => row.org.id));
  const empty: EmptyOrgRow[] = [...orgById.values()]
    .filter((org) => !filled.has(org.id) && inView(org))
    .map((org) => ({ key: `empty-${org.id}`, org, empty: true }));
  return [...shown, ...empty].sort(compareDefault);
}

/** Every checked org id, broadest layer first (for the URL). */
export function checkedOrgIds(
  filters: LayerFilters,
  layers: readonly OrgType[],
): number[] {
  return layers.flatMap((l) => filters[l] ?? []);
}

/**
 * Filters with each of `orgIds` checked (and its ancestors, as when checked by
 * hand). Ids that aren't in a filter layer — unknown, nation, AO — are skipped.
 */
export function filtersFromOrgIds(
  orgIds: readonly number[],
  layers: readonly OrgType[],
  orgById: Map<number, Org>,
): LayerFilters {
  let filters: LayerFilters = {};
  for (const id of orgIds) {
    const org = orgById.get(id);
    if (org) filters = checkOrg(filters, org, layers, orgById);
  }
  return filters;
}

/**
 * The org the Map should open on for these filters: the one checked org in the
 * narrowest layer that has exactly one checked, or null (Nation) when no
 * layer does. E.g. one sector, one territory, and three areas → the territory.
 */
export function mapFocusOrgId(
  filters: LayerFilters,
  layers: readonly OrgType[],
): number | null {
  for (const layer of [...layers].reverse()) {
    const ids = filters[layer] ?? [];
    if (ids.length === 1) return ids[0]!;
  }
  return null;
}

/** The rows for one org, for the phone accordion. */
export interface OrgGroup {
  org: Org;
  rows: TableRow[];
  /** True when the org has nobody listed (its only row is a placeholder). */
  empty: boolean;
}

/** `rows` grouped by org, in the order each org first appears. */
export function groupRowsByOrg(rows: readonly TableRow[]): OrgGroup[] {
  const groups = new Map<number, OrgGroup>();
  for (const row of rows) {
    const group = groups.get(row.org.id);
    if (group) group.rows.push(row);
    else
      groups.set(row.org.id, {
        org: row.org,
        rows: [row],
        empty: isEmptyOrgRow(row),
      });
  }
  return [...groups.values()];
}
