import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IsActiveStatus } from "@acme/shared/app/enums";
import type { OrgType } from "@acme/shared/app/enums";
import type * as OrgHierarchy from "@acme/shared/app/org-hierarchy";
import type { OrgAdminConfig } from "./org-admin-config";

interface TestOrg {
  id: number;
  parentId: number | null;
  name: string;
  orgType: string;
  isActive: boolean;
}

const mocks = vi.hoisted(() => ({
  hierarchyOrgs: undefined as TestOrg[] | undefined,
  fetchPage: undefined as
    | ((page: { pageIndex: number; pageSize: number }) => Promise<unknown>)
    | undefined,
}));

vi.mock("~/orpc/client", () => ({ client: { org: { all: vi.fn() } } }));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: (options: { fetchPage: typeof mocks.fetchPage }) => {
    mocks.fetchPage = options.fetchPage;
    return { data: mocks.hierarchyOrgs };
  },
}));
// A tier the OrgType enum does not have: nothing but its display entry and the
// config below knows about it.
vi.mock("@acme/shared/app/org-hierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof OrgHierarchy>();
  return {
    ...actual,
    orgTypeDisplay: {
      ...actual.orgTypeDisplay,
      zone: {
        ...actual.orgTypeDisplay.sector,
        label: "Zone",
        pluralLabel: "Zones",
      },
    },
  };
});

import { client } from "~/orpc/client";
import { useOrgFilters } from "./use-org-filters";

// The one tier the OrgType enum does not know.
const zone = "zone" as OrgType;

type HookOrg = Parameters<ReturnType<typeof useOrgFilters>["toggle"]>[1];
const asOrg = (testOrg: TestOrg) => testOrg as unknown as HookOrg;

// Sector > Zone > Territory, declared as configuration only.
const zoneConfig: OrgAdminConfig = {
  add: false,
  serverPagination: true,
  serverSorting: false,
  filters: "hierarchy",
  hierarchyFilter: {
    tiers: ["sector", zone, "territory"],
    match: { tiers: ["territory"], includeInactive: true },
  },
  ancestorTypes: ["sector", zone, "territory", "nation"],
  columns: [],
  statusId: "status",
  aoCount: false,
};

const org = (
  id: number,
  parentId: number | null,
  orgType: string,
  isActive = true,
): TestOrg => ({ id, parentId, name: `${orgType} ${id}`, orgType, isActive });

const nation = org(1, null, "nation");
const sectorOne = org(2, 1, "sector");
const sectorTwo = org(3, 1, "sector");
const zoneOne = org(4, 2, "zone");
const zoneTwo = org(5, 3, "zone");
const inactiveZone = org(6, 2, "zone", false);
const territoryOne = org(7, 4, "territory");
const territoryTwo = org(8, 5, "territory");
const inactiveTerritory = org(9, 4, "territory", false);

describe("a tier added by configuration only", () => {
  const resetPage = vi.fn();

  beforeEach(() => {
    resetPage.mockReset();
    mocks.hierarchyOrgs = [
      nation,
      sectorOne,
      sectorTwo,
      zoneOne,
      zoneTwo,
      inactiveZone,
      territoryOne,
      territoryTwo,
      inactiveTerritory,
    ];
  });

  const setup = () => {
    const hook = renderHook(() => useOrgFilters(zoneConfig, resetPage));
    const toggle = (control: number, id: number) =>
      act(() => {
        const { onToggle, orgs } = hook.result.current.filterControls[control]!;
        onToggle(orgs!.find((candidate) => candidate.id === id)!);
      });
    return { ...hook, toggle };
  };
  const offeredIds = (
    result: ReturnType<typeof setup>["result"],
    control: number,
  ) => result.current.filterControls[control]?.orgs?.map(({ id }) => id);

  it("gets a labelled picker per tier offering only active orgs", () => {
    const { result } = setup();

    expect(
      result.current.filterControls.map(({ orgType, label }) => [
        orgType,
        label,
      ]),
    ).toEqual([
      ["sector", "Sector"],
      ["zone", "Zone"],
      ["territory", "Territory"],
    ]);
    expect(offeredIds(result, 1)).toEqual([zoneOne.id, zoneTwo.id]);
    expect(offeredIds(result, 2)).toEqual([territoryOne.id, territoryTwo.id]);
    expect(result.current.parentOrgIds).toBeUndefined();
  });

  it("narrows the later pickers to the selected first tier", () => {
    const { result, toggle } = setup();

    toggle(0, sectorOne.id);

    expect(offeredIds(result, 1)).toEqual([zoneOne.id]);
    expect(offeredIds(result, 2)).toEqual([territoryOne.id]);
    expect(resetPage).toHaveBeenCalledTimes(1);
  });

  it("expands a first-tier selection through the new tier, inactive included", () => {
    const { result, toggle } = setup();

    toggle(0, sectorOne.id);

    expect(result.current.parentOrgIds).toEqual([
      sectorOne.id,
      zoneOne.id,
      inactiveZone.id,
      territoryOne.id,
      inactiveTerritory.id,
    ]);
  });

  it("expands a selection in the new tier to the orgs beneath it", () => {
    const { result, toggle } = setup();

    toggle(1, zoneOne.id);

    expect(result.current.parentOrgIds).toEqual([
      zoneOne.id,
      territoryOne.id,
      inactiveTerritory.id,
    ]);
  });

  it("lets the deepest selected tier win", () => {
    const { result, toggle } = setup();

    toggle(0, sectorOne.id);
    toggle(1, zoneOne.id);
    toggle(2, territoryOne.id);

    expect(result.current.parentOrgIds).toEqual([territoryOne.id]);
  });

  it("prunes new-tier selections when their sector is deselected", () => {
    const { result, toggle } = setup();

    toggle(0, sectorOne.id);
    toggle(0, sectorTwo.id);
    toggle(1, zoneOne.id);
    toggle(1, zoneTwo.id);
    toggle(0, sectorOne.id);

    expect(
      result.current.filterControls[1]?.selected.map(({ id }) => id),
    ).toEqual([zoneTwo.id]);
    expect(result.current.parentOrgIds).toEqual([zoneTwo.id, territoryTwo.id]);
  });

  it("drops a selection whose org is no longer offered", () => {
    const { result, rerender, toggle } = setup();

    toggle(1, zoneOne.id);
    mocks.hierarchyOrgs = mocks.hierarchyOrgs?.map((candidate) =>
      candidate.id === zoneOne.id
        ? { ...candidate, isActive: false }
        : candidate,
    );
    rerender();

    expect(result.current.filterControls[1]?.selected).toEqual([]);
    expect(result.current.parentOrgIds).toBeUndefined();
  });

  it("requests nothing while the hierarchy is unavailable", () => {
    const { result, rerender, toggle } = setup();

    toggle(0, sectorOne.id);
    mocks.hierarchyOrgs = undefined;
    rerender();

    expect(result.current.parentOrgIds).toEqual([-1]);
  });

  it("clears its selections on reset", () => {
    const { result, toggle } = setup();

    toggle(0, sectorOne.id);
    toggle(1, zoneOne.id);
    act(() => {
      result.current.reset();
    });

    expect(result.current.parentOrgIds).toBeUndefined();
    expect(result.current.activeFilterCount).toBe(2);
  });
  it("loads every configured tier, active or not, in pages", async () => {
    vi.mocked(client.org.all).mockResolvedValue({
      orgs: [],
      total: 0,
    });
    setup();

    await mocks.fetchPage?.({ pageIndex: 2, pageSize: 50 });

    expect(client.org.all).toHaveBeenCalledWith({
      orgTypes: ["sector", "zone", "territory", "nation"],
      statuses: IsActiveStatus,
      pageIndex: 2,
      pageSize: 50,
    });
  });

  it("also loads intermediate types, which are never offered as filters", async () => {
    vi.mocked(client.org.all).mockResolvedValue({ orgs: [], total: 0 });
    const intermediate = "area" as OrgType;
    renderHook(() =>
      useOrgFilters(
        { ...zoneConfig, intermediateTypes: [intermediate] },
        resetPage,
      ),
    );

    await mocks.fetchPage?.({ pageIndex: 0, pageSize: 50 });

    expect(client.org.all).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orgTypes: ["sector", "zone", "territory", "nation", "area"],
      }),
    );
  });
});

describe("the AO table's own-fetch region filter", () => {
  const resetPage = vi.fn();
  const regionConfig: OrgAdminConfig = {
    add: true,
    serverPagination: true,
    serverSorting: true,
    filters: "region",
    columns: [],
    statusId: "isActive",
    aoCount: false,
  };

  beforeEach(() => {
    resetPage.mockReset();
    mocks.hierarchyOrgs = undefined;
  });

  it("sends the picked regions as-is, and an empty list when none", () => {
    const { result } = renderHook(() => useOrgFilters(regionConfig, resetPage));
    const region = asOrg(org(20, 1, "region"));

    expect(result.current.filterControls).toEqual([]);
    expect(result.current.parentOrgIds).toEqual([]);

    act(() => result.current.toggle("region", region));
    expect(result.current.parentOrgIds).toEqual([20]);
    expect(result.current.selectedRegions).toHaveLength(1);
    expect(result.current.activeFilterCount).toBe(3);

    act(() => result.current.toggle("region", region));
    expect(result.current.parentOrgIds).toEqual([]);
    expect(resetPage).toHaveBeenCalledTimes(2);
  });
});
