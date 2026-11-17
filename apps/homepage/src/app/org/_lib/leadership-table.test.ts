import { describe, it, expect } from "vitest";
import type { LeaderEntry, Org } from "./types";
import type { LayerFilters, TableRow } from "./leadership-table";
import {
  buildRows,
  checkedOrgIds,
  checkOrg,
  clearLayerFilter,
  filterRows,
  filtersFromOrgIds,
  getLayerOptions,
  getPresentLayers,
  getScopeOrgs,
  groupRowsByOrg,
  isEmptyOrgRow,
  isWithin,
  mapFocusOrgId,
  nextSort,
  sortRows,
  toggleLayerFilter,
} from "./leadership-table";

// Nation → Southeast (sector) → NC, FL (territories) → areas → regions.
// "Orphan Region" hangs directly off the sector (no territory or area).
const ORGS: Org[] = [
  { id: 1, name: "Nation", orgType: "nation", parentId: null },
  { id: 2, name: "Southeast", orgType: "sector", parentId: 1 },
  { id: 3, name: "North Carolina", orgType: "territory", parentId: 2 },
  { id: 4, name: "Florida", orgType: "territory", parentId: 2 },
  { id: 5, name: "Western NC", orgType: "area", parentId: 3 },
  { id: 6, name: "Miami", orgType: "area", parentId: 4 },
  { id: 7, name: "Boone", orgType: "region", parentId: 5 },
  { id: 8, name: "Coral Gables", orgType: "region", parentId: 6 },
  { id: 9, name: "Orphan Region", orgType: "region", parentId: 2 },
  { id: 10, name: "Some AO", orgType: "ao", parentId: 7 },
];
const orgById = new Map(ORGS.map((o) => [o.id, o]));
const layers = getPresentLayers(orgById);

let nextUserId = 100;
function leader(
  orgId: number,
  title: string,
  f3Name: string | null,
  kind: LeaderEntry["kind"] = "position",
): LeaderEntry {
  return {
    orgId,
    kind,
    id: title.length,
    title,
    userId: nextUserId++,
    f3Name,
    avatarUrl: null,
    homeRegionName: null,
  };
}

describe("getPresentLayers", () => {
  it("lists present navigable layers broadest first", () => {
    expect(layers).toEqual(["sector", "territory", "area", "region"]);
  });

  it("omits layers with no orgs", () => {
    const noTerritory = new Map(
      ORGS.filter((o) => o.orgType !== "territory").map((o) => [o.id, o]),
    );
    expect(getPresentLayers(noTerritory)).toEqual(["sector", "area", "region"]);
  });
});

describe("isWithin", () => {
  it("matches the org itself and its ancestors", () => {
    expect(isWithin(orgById.get(7)!, 7, orgById)).toBe(true);
    expect(isWithin(orgById.get(7)!, 3, orgById)).toBe(true);
    expect(isWithin(orgById.get(7)!, 4, orgById)).toBe(false);
  });

  it("stops on a parent cycle", () => {
    const a: Org = { id: 1, name: "A", orgType: "area", parentId: 2 };
    const b: Org = { id: 2, name: "B", orgType: "area", parentId: 1 };
    const cyclic = new Map([
      [1, a],
      [2, b],
    ]);
    expect(isWithin(a, 99, cyclic)).toBe(false);
  });
});

describe("buildRows", () => {
  it("drops AO, nation, and unknown orgs and sorts broadest level first", () => {
    const rows = buildRows(
      [
        leader(7, "Site Q", "Zed"),
        leader(7, "Site Q", "Abe"),
        leader(7, "Nant'an", null),
        leader(2, "admin", "Root", "role"),
        leader(10, "AO Q", "Skip"),
        leader(1, "admin", "Mainframe", "role"),
        leader(404, "Ghost", "Nobody"),
      ],
      orgById,
      layers,
    );
    expect(rows.map((r) => `${r.org.name}:${r.title}:${r.f3Name}`)).toEqual([
      "Southeast:admin:Root",
      "Boone:Nant'an:null",
      "Boone:Site Q:Abe",
      "Boone:Site Q:Zed",
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("keeps each of two same-named orgs' rows together", () => {
    const twins = new Map(orgById);
    twins.set(21, { id: 21, name: "Downtown", orgType: "region", parentId: 5 });
    twins.set(22, { id: 22, name: "Downtown", orgType: "region", parentId: 6 });
    const rows = buildRows(
      [
        leader(22, "A Title", "One"),
        leader(21, "B Title", "Two"),
        leader(22, "C Title", "Three"),
        leader(21, "D Title", "Four"),
      ],
      twins,
      layers,
    );
    expect(rows.map((r) => `${r.orgId}:${r.title}`)).toEqual([
      "21:B Title",
      "21:D Title",
      "22:A Title",
      "22:C Title",
    ]);
  });
});

const names = (orgs: Org[]) => orgs.map((o) => o.name);
const toggle = (f: LayerFilters, id: number) =>
  toggleLayerFilter(f, id, layers, orgById);

describe("filters", () => {
  it("offers every org of a layer when nothing broader is checked", () => {
    expect(names(getLayerOptions("region", {}, layers, orgById))).toEqual([
      "Boone",
      "Coral Gables",
      "Orphan Region",
    ]);
  });

  it("narrows narrower filters to the checked territory", () => {
    const nc = toggle({}, 3);
    expect(nc).toEqual({ sector: [2], territory: [3] });
    expect(names(getLayerOptions("area", nc, layers, orgById))).toEqual([
      "Western NC",
    ]);
    expect(names(getLayerOptions("region", nc, layers, orgById))).toEqual([
      "Boone",
    ]);
    // Broader filters keep their full option list.
    expect(getLayerOptions("territory", nc, layers, orgById)).toHaveLength(2);
  });

  it("offers orgs inside any of several checked territories", () => {
    const both = toggle(toggle({}, 3), 4);
    expect(both.territory).toEqual([3, 4]);
    expect(names(getLayerOptions("region", both, layers, orgById))).toEqual([
      "Boone",
      "Coral Gables",
    ]);
  });

  it("checks every ancestor when a region is checked", () => {
    expect(toggle({}, 7)).toEqual({
      sector: [2],
      territory: [3],
      area: [5],
      region: [7],
    });
  });

  it("skips a tier an org has no ancestor in", () => {
    expect(toggle({}, 9)).toEqual({ sector: [2], region: [9] });
  });

  it("unchecks narrower choices inside an unchecked org", () => {
    const boone = toggle({}, 7);
    expect(toggle(boone, 3)).toEqual({ sector: [2] });
    expect(toggle(boone, 7)).toEqual({
      sector: [2],
      territory: [3],
      area: [5],
    });
  });

  it("ignores unknown and non-layer orgs", () => {
    expect(toggle({}, 404)).toEqual({});
    expect(toggle({}, 10)).toEqual({});
  });

  it("clears a filter and every narrower one", () => {
    const boone = toggle({}, 7);
    expect(clearLayerFilter(boone, "territory", layers)).toEqual({
      sector: [2],
    });
  });

  it("checks a searched org once", () => {
    const boone = checkOrg({}, orgById.get(7)!, layers, orgById);
    expect(boone.region).toEqual([7]);
    expect(checkOrg(boone, orgById.get(7)!, layers, orgById)).toBe(boone);
  });

  it("scopes to checked orgs without checked descendants", () => {
    // NC narrowed to Western NC; Florida left whole.
    const f = toggle(toggle({}, 5), 4);
    expect(names(getScopeOrgs(f, layers, orgById))).toEqual([
      "Florida",
      "Western NC",
    ]);
  });

  it("filters rows to the scope orgs and below", () => {
    const rows = buildRows(
      [
        leader(2, "admin", "Root", "role"),
        leader(7, "Site Q", "Abe"),
        leader(8, "Site Q", "Cal"),
        leader(9, "Site Q", "Dee"),
      ],
      orgById,
      layers,
    );
    // No filters: only the broadest layer's (sector) positions.
    expect(
      filterRows(rows, {}, layers, orgById).map((r) => r.org.name),
    ).toEqual(["Southeast"]);
    const f = toggle(toggle({}, 5), 4);
    // In-scope orgs with nobody listed get a placeholder row, in place.
    const label = (r: TableRow) =>
      isEmptyOrgRow(r) ? `${r.org.name}: empty` : `${r.org.name}: ${r.f3Name}`;
    expect(filterRows(rows, f, layers, orgById).map(label)).toEqual([
      "Florida: empty",
      "Miami: empty",
      "Western NC: empty",
      "Boone: Abe",
      "Coral Gables: Cal",
    ]);
  });

  it("adds placeholders only for empty orgs in view", () => {
    const rows = buildRows([leader(7, "Site Q", "Abe")], orgById, layers);
    // No filters: the sector, with nobody listed, is the only org in view.
    const [sector] = filterRows(rows, {}, layers, orgById);
    expect(sector).toEqual({
      key: "empty-2",
      org: orgById.get(2),
      empty: true,
    });
    expect(filterRows(rows, toggle({}, 7), layers, orgById)).toEqual(rows);
  });
});

describe("sorting with empty-org rows", () => {
  const rows = filterRows(
    buildRows([leader(7, "Site Q", "zed")], orgById, layers),
    toggle({}, 5),
    layers,
    orgById,
  );

  it.each([
    ["pax", "asc"],
    ["pax", "desc"],
    ["title", "desc"],
  ] as const)("keeps them last when sorting by %s %s", (column, direction) => {
    expect(
      sortRows(rows, { column, direction }).map((r) => r.org.name),
    ).toEqual(["Boone", "Western NC"]);
  });

  it("sorts them with the rest by org", () => {
    expect(
      sortRows(rows, { column: "org", direction: "desc" }).map(
        (r) => r.org.name,
      ),
    ).toEqual(["Western NC", "Boone"]);
  });
});

describe("sorting", () => {
  const rows = buildRows(
    [
      leader(7, "Site Q", "zed"),
      leader(8, "ITQ", "Abe"),
      leader(3, "Territory Q", null),
    ],
    orgById,
    layers,
  );

  it("keeps the default order without a sort", () => {
    expect(sortRows(rows, null)).toBe(rows);
  });

  it.each([
    ["org", "asc", ["Boone", "Coral Gables", "North Carolina"]],
    ["org", "desc", ["North Carolina", "Coral Gables", "Boone"]],
    ["title", "asc", ["Coral Gables", "Boone", "North Carolina"]],
  ] as const)("sorts by %s %s", (column, direction, expected) => {
    expect(
      sortRows(rows, { column, direction }).map((r) => r.org.name),
    ).toEqual(expected);
  });

  it("sorts PAX case-insensitively with missing names first", () => {
    expect(
      sortRows(rows, { column: "pax", direction: "asc" }).map((r) => r.f3Name),
    ).toEqual([null, "Abe", "zed"]);
  });

  it("cycles asc, desc, then default", () => {
    const asc = nextSort(null, "pax");
    expect(asc).toEqual({ column: "pax", direction: "asc" });
    const desc = nextSort(asc, "pax");
    expect(desc).toEqual({ column: "pax", direction: "desc" });
    expect(nextSort(desc, "pax")).toBeNull();
    expect(nextSort(desc, "org")).toEqual({ column: "org", direction: "asc" });
  });
});

describe("URL and Map hand-off", () => {
  it("round-trips checked orgs through their ids", () => {
    const filters = toggle(toggle({}, 7), 8);
    const ids = checkedOrgIds(filters, layers);
    expect(ids).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(filtersFromOrgIds(ids, layers, orgById)).toEqual(filters);
  });

  it("checks an org and its ancestors, skipping ids outside the layers", () => {
    expect(filtersFromOrgIds([5, 1, 10, 999], layers, orgById)).toEqual({
      sector: [2],
      territory: [3],
      area: [5],
    });
    expect(filtersFromOrgIds([], layers, orgById)).toEqual({});
  });

  it("opens the Map on the narrowest layer with exactly one checked org", () => {
    // One sector, one territory, two areas → the territory.
    expect(
      mapFocusOrgId({ sector: [2], territory: [3], area: [5, 6] }, layers),
    ).toBe(3);
    // A single region wins over everything broader.
    expect(mapFocusOrgId(toggle({}, 7), layers)).toBe(7);
    // Two territories and nothing narrower → the sector.
    expect(mapFocusOrgId(toggle(toggle({}, 3), 4), layers)).toBe(2);
    expect(mapFocusOrgId({}, layers)).toBeNull();
    expect(mapFocusOrgId({ sector: [2, 99] }, layers)).toBeNull();
  });
});

describe("groupRowsByOrg", () => {
  it("groups rows by org in first-appearance order, flagging empty orgs", () => {
    const rows = filterRows(
      buildRows(
        [leader(7, "Site Q", "Abe"), leader(7, "IT Q", "Bo")],
        orgById,
        layers,
      ),
      toggle({}, 5),
      layers,
      orgById,
    );
    expect(
      groupRowsByOrg(rows).map((g) => [g.org.name, g.rows.length, g.empty]),
    ).toEqual([
      ["Western NC", 1, true],
      ["Boone", 2, false],
    ]);
  });
});
