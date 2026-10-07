import { fireEvent, render, screen } from "@testing-library/react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryInput {
  orgTypes: string[];
  pageIndex?: number;
  pageSize?: number;
  parentOrgIds?: number[];
  statuses?: ("active" | "inactive")[];
  onlyMine?: boolean;
  searchTerm?: string;
}

interface TestOrg {
  id: number;
  parentId: number | null;
  name: string;
  orgType: string;
  isActive: boolean;
}

const mocks = vi.hoisted(() => ({
  hierarchyAvailable: true,
  hierarchyOrgs: [] as TestOrg[],
  queryInputs: [] as QueryInput[],
  resultOrgs: [] as TestOrg[],
}));

vi.mock("~/orpc/react", () => ({
  orpc: {
    org: {
      all: {
        queryOptions: ({ input }: { input: QueryInput }) => ({ input }),
      },
    },
  },
  useQuery: (
    options:
      | { input: QueryInput }
      | {
          queryKey: [
            readonly string[],
            {
              key: [string, string[] | undefined, string[] | undefined];
            },
          ];
          enabled?: boolean;
        },
  ) => {
    // org-table.tsx's own direct paginated table query, unchanged.
    if ("input" in options) {
      const { input } = options;
      mocks.queryInputs.push(input);

      const isResultQuery =
        input.orgTypes.length === 1 &&
        (input.orgTypes[0] === "region" || input.pageIndex !== undefined);

      if (!isResultQuery && !mocks.hierarchyAvailable)
        return { data: undefined };

      return {
        data: {
          orgs: isResultQuery
            ? mocks.resultOrgs
            : mocks.hierarchyOrgs.filter(
                (org) =>
                  input.orgTypes.includes(org.orgType) &&
                  // Like the real org.all: no statuses means active rows only.
                  (input.statuses ?? ["active"]).includes(
                    org.isActive ? "active" : "inactive",
                  ),
              ),
          total: 0,
        },
      };
    }

    // use-org-filters.ts's useFetchAllPages hierarchy query -- identified by
    // the absence of `input` (useFetchAllPages calls useQuery with
    // queryKey/fetchPage, never an oRPC-generated `input`). Mirrors the
    // input-based branch above but returns the flattened array
    // useFetchAllPages produces, not the {orgs, total} page shape.
    // queryKey is [name, ancestorTypes, intermediateTypes] -- combine both
    // type lists, matching use-org-filters.ts's fetchPage orgTypes input.
    const { queryKey, enabled } = options;
    if (enabled === false) return { data: undefined };
    const key = queryKey[1].key;
    const orgTypes = [...(key[1] ?? []), ...(key[2] ?? [])];
    mocks.queryInputs.push({ orgTypes });

    if (!mocks.hierarchyAvailable) return { data: undefined };

    return {
      data: mocks.hierarchyOrgs.filter((org) => orgTypes.includes(org.orgType)),
    };
  },
}));

vi.mock("@acme/ui/md-table", async () => {
  const React = await vi.importActual<typeof ReactModule>("react");

  return {
    MDTable: ({
      data,
      filterComponent,
      setPagination,
      setSearchTerm,
    }: {
      data: TestOrg[] | undefined;
      filterComponent: React.ReactNode;
      setPagination: (value: { pageIndex: number; pageSize: number }) => void;
      setSearchTerm: (value: string) => void;
    }) => (
      <div>
        <output data-testid="table-data">{JSON.stringify(data)}</output>
        <button
          data-testid="next-page"
          onClick={() => setPagination({ pageIndex: 2, pageSize: 50 })}
        >
          Next page
        </button>
        <button data-testid="search" onClick={() => setSearchTerm("needle")}>
          Search
        </button>
        {filterComponent}
      </div>
    ),
    usePagination: () => {
      const [pagination, setPagination] = React.useState({
        pageIndex: 0,
        pageSize: 20,
      });
      return { pagination, setPagination };
    },
  };
});

vi.mock("./sector-filter", () => ({
  SectorFilter: ({
    onSectorSelect,
    sectors,
  }: {
    onSectorSelect: (sector: TestOrg) => void;
    sectors: TestOrg[] | undefined;
  }) => (
    <div>
      {sectors?.map((sector) => (
        <button
          key={sector.id}
          data-testid={`sector-${sector.id}`}
          onClick={() => onSectorSelect(sector)}
        >
          {sector.name}
        </button>
      ))}
      <button
        data-testid="select-first-two-sectors"
        onClick={() => {
          if (sectors?.[0]) onSectorSelect(sectors[0]);
          if (sectors?.[1]) onSectorSelect(sectors[1]);
        }}
      >
        Select first two sectors
      </button>
    </div>
  ),
}));

vi.mock("./area-filter", () => ({
  AreaFilter: ({
    areas,
    onAreaSelect,
    selectedAreas,
  }: {
    areas: TestOrg[] | undefined;
    onAreaSelect: (area: TestOrg) => void;
    selectedAreas: TestOrg[];
  }) => (
    <div>
      {areas?.map((area) => (
        <button
          key={area.id}
          data-testid={`area-${area.id}`}
          aria-pressed={selectedAreas.some(
            (selected) => selected.id === area.id,
          )}
          onClick={() => onAreaSelect(area)}
        >
          {area.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./territory-filter", () => ({
  TerritoryFilter: ({
    territories,
    onTerritorySelect,
    selectedTerritories,
  }: {
    territories: TestOrg[] | undefined;
    onTerritorySelect: (territory: TestOrg) => void;
    selectedTerritories: TestOrg[];
  }) => (
    <div>
      {territories?.map((territory) => (
        <button
          key={territory.id}
          data-testid={`territory-${territory.id}`}
          aria-pressed={selectedTerritories.some(
            (selected) => selected.id === territory.id,
          )}
          onClick={() => onTerritorySelect(territory)}
        >
          {territory.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../mobile-filter-sheet", () => ({
  MobileFilterSheet: () => null,
}));
vi.mock("../reset-filter", () => ({
  ResetFilter: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="reset-filters" onClick={onClick}>
      Reset
    </button>
  ),
}));
vi.mock("../status-filter", () => ({
  StatusFilter: ({
    setSelectedStatuses,
    setOnlyMine,
    resetPage,
  }: {
    setSelectedStatuses: (value: string[]) => void;
    setOnlyMine: (value: boolean) => void;
    resetPage: () => void;
  }) => (
    <button
      data-testid="inactive-all"
      onClick={() => {
        setSelectedStatuses(["inactive"]);
        setOnlyMine(false);
        resetPage();
      }}
    >
      Inactive, all organizations
    </button>
  ),
}));
vi.mock("~/utils/store/modal", () => ({
  DeleteType: { ORG: "org" },
  ModalType: {
    ADMIN_ORG: "admin-org",
    ADMIN_DELETE_CONFIRMATION: "admin-delete-confirmation",
  },
  openModal: vi.fn(),
}));

import { OrgTable } from "./org-table";

const nation: TestOrg = {
  id: 1,
  parentId: null,
  name: "Nation",
  orgType: "nation",
  isActive: true,
};
const sectorOne: TestOrg = {
  id: 2,
  parentId: nation.id,
  name: "Sector One",
  orgType: "sector",
  isActive: true,
};
const territory: TestOrg = {
  id: 3,
  parentId: sectorOne.id,
  name: "Territory",
  orgType: "territory",
  isActive: false,
};
const nestedArea: TestOrg = {
  id: 4,
  parentId: territory.id,
  name: "Nested Area",
  orgType: "area",
  isActive: true,
};
const directArea: TestOrg = {
  id: 5,
  parentId: sectorOne.id,
  name: "Direct Area",
  orgType: "area",
  isActive: true,
};
const sectorTwo: TestOrg = {
  id: 6,
  parentId: nation.id,
  name: "Sector Two",
  orgType: "sector",
  isActive: true,
};
const secondSectorArea: TestOrg = {
  id: 7,
  parentId: sectorTwo.id,
  name: "Second Sector Area",
  orgType: "area",
  isActive: true,
};
const inactiveArea: TestOrg = {
  id: 8,
  parentId: sectorOne.id,
  name: "Inactive Area",
  orgType: "area",
  isActive: false,
};
const inactiveSector: TestOrg = {
  id: 11,
  parentId: nation.id,
  name: "Inactive Sector",
  orgType: "sector",
  isActive: false,
};
const nestedRegion: TestOrg = {
  id: 9,
  parentId: nestedArea.id,
  name: "Nested Region",
  orgType: "region",
  isActive: true,
};
const inactiveAreaRegion: TestOrg = {
  id: 12,
  parentId: inactiveArea.id,
  name: "Inactive Area Region",
  orgType: "region",
  isActive: true,
};

const latestResultQuery = () => {
  for (let index = mocks.queryInputs.length - 1; index >= 0; index -= 1) {
    const input = mocks.queryInputs[index];
    if (
      input?.orgTypes.length === 1 &&
      (input.orgTypes[0] === "region" || input.pageIndex !== undefined)
    ) {
      return input;
    }
  }

  return undefined;
};

const expectParentIds = (...ids: number[]) => {
  expect(
    [...(latestResultQuery()?.parentOrgIds ?? [])].sort((a, b) => a - b),
  ).toEqual([...ids].sort((a, b) => a - b));
};

describe("depth-agnostic admin organization filters", () => {
  beforeEach(() => {
    mocks.hierarchyAvailable = true;
    mocks.hierarchyOrgs = [
      nation,
      sectorOne,
      territory,
      nestedArea,
      directArea,
      sectorTwo,
      secondSectorArea,
      inactiveArea,
      inactiveSector,
    ];
    mocks.queryInputs = [];
    mocks.resultOrgs = [];
  });

  it("filters regions through mixed direct and territory ancestry", () => {
    mocks.resultOrgs = [nestedRegion];
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expectParentIds(
      sectorOne.id,
      territory.id,
      nestedArea.id,
      directArea.id,
      inactiveArea.id,
    );
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"area":"Nested Area"',
    );
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"sector":"Sector One"',
    );
    expect(screen.queryByTestId(`sector-${inactiveSector.id}`)).toBeNull();
  });

  it("displays ancestry for a region whose immediate area is inactive", () => {
    mocks.resultOrgs = [inactiveAreaRegion];
    render(<OrgTable orgType="region" />);

    expect(screen.getByTestId("table-data").textContent).toContain(
      '"area":"Inactive Area"',
    );
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"sector":"Sector One"',
    );
  });

  it("retains both selections when sector callbacks occur before a render", () => {
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));

    expectParentIds(
      sectorOne.id,
      territory.id,
      nestedArea.id,
      directArea.id,
      sectorTwo.id,
      secondSectorArea.id,
      inactiveArea.id,
    );
  });

  it("gives directly selected areas priority over sector-derived areas", () => {
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([nestedArea.id]);
  });

  it("removes only the deselected Area from a Region table filter", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondSectorArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    expect(latestResultQuery()?.parentOrgIds).toEqual([secondSectorArea.id]);
  });

  it("retains directly selected areas when the last sector is deselected", () => {
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([nestedArea.id]);
  });

  it("resets sector and area selections together", () => {
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    fireEvent.click(screen.getByTestId("reset-filters"));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("prunes selected areas when their sector is deselected", () => {
    render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondSectorArea.id}`));
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([secondSectorArea.id]);
  });

  it("prunes an area using its refreshed ancestry after reparenting", () => {
    const { rerender } = render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === nestedArea.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorTwo.id}`));

    expectParentIds(sectorOne.id, territory.id, directArea.id, inactiveArea.id);
  });

  it("drops a selected area reparented out of the selected sector on refetch", () => {
    const { rerender } = render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    expect(latestResultQuery()?.parentOrgIds).toEqual([nestedArea.id]);

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === nestedArea.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="region" />);

    expectParentIds(sectorOne.id, territory.id, directArea.id, inactiveArea.id);
  });

  it("does not restore a dropped area when the sector selection is cleared", () => {
    const { rerender } = render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === nestedArea.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="region" />);
    expectParentIds(sectorOne.id, territory.id, directArea.id, inactiveArea.id);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("filters areas through a territory parent", () => {
    mocks.resultOrgs = [nestedArea];
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      sectorOne.id,
      territory.id,
    ]);
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"sector":"Sector One"',
    );
    expect(mocks.queryInputs[0]?.orgTypes).toEqual([
      "territory",
      "sector",
      "nation",
      "area",
    ]);
  });

  it("keeps the area query fail-closed while hierarchy data is unavailable", () => {
    const { rerender } = render(<OrgTable orgType="area" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    mocks.hierarchyAvailable = false;
    rerender(<OrgTable orgType="area" />);

    expect(latestResultQuery()?.parentOrgIds).toEqual([-1]);
  });

  it("deselects an area-table sector after a refetch replaces its object", () => {
    const { rerender } = render(<OrgTable orgType="area" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === sectorOne.id ? { ...org } : org,
    );
    rerender(<OrgTable orgType="area" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });
});

const secondTerritory: TestOrg = {
  id: 13,
  parentId: sectorOne.id,
  name: "Second Territory",
  orgType: "territory",
  isActive: true,
};
const secondTerritoryArea: TestOrg = {
  id: 14,
  parentId: secondTerritory.id,
  name: "Second Territory Area",
  orgType: "area",
  isActive: true,
};
const sectorTwoTerritory: TestOrg = {
  id: 15,
  parentId: sectorTwo.id,
  name: "Sector Two Territory",
  orgType: "territory",
  isActive: true,
};

describe("territory-aware admin organization filters", () => {
  beforeEach(() => {
    mocks.hierarchyAvailable = true;
    mocks.hierarchyOrgs = [
      nation,
      sectorOne,
      territory,
      secondTerritory,
      nestedArea,
      directArea,
      secondTerritoryArea,
      sectorTwo,
      sectorTwoTerritory,
      inactiveSector,
    ];
    mocks.queryInputs = [];
    mocks.resultOrgs = [];
  });

  it("filters the territory table by the sector directly above it", () => {
    render(<OrgTable orgType="territory" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([sectorOne.id]);
    expect(mocks.queryInputs[0]?.orgTypes).toEqual(["sector", "nation"]);
    expect(screen.queryByTestId(`sector-${inactiveSector.id}`)).toBeNull();
  });

  it("requests no territories for a sector selection while hierarchy data is unavailable", () => {
    const { rerender } = render(<OrgTable orgType="territory" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    mocks.hierarchyAvailable = false;
    rerender(<OrgTable orgType="territory" />);

    expect(latestResultQuery()?.parentOrgIds).toEqual([-1]);
  });

  it("offers only active territories to the area table's territory filter", () => {
    render(<OrgTable orgType="area" />);

    expect(screen.queryByTestId(`territory-${territory.id}`)).toBeNull();
    expect(screen.getByTestId(`territory-${secondTerritory.id}`)).toBeTruthy();
    expect(
      screen.getByTestId(`territory-${sectorTwoTerritory.id}`),
    ).toBeTruthy();
  });

  it("narrows the territory filter to territories beneath the selected sectors", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(screen.getByTestId(`territory-${secondTerritory.id}`)).toBeTruthy();
    expect(
      screen.queryByTestId(`territory-${sectorTwoTerritory.id}`),
    ).toBeNull();
  });

  it("matches areas directly under the sector and under any of its territories", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      sectorOne.id,
      territory.id,
      secondTerritory.id,
    ]);
  });

  it("gives a directly selected territory priority over the sector selection", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([secondTerritory.id]);
  });

  it("matches a directly selected territory when no sector is selected", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([sectorTwoTerritory.id]);
  });

  it("removes only the deselected Territory from an Area table filter", () => {
    render(<OrgTable orgType="area" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(latestResultQuery()?.parentOrgIds).toEqual([sectorTwoTerritory.id]);
  });

  it("prunes selected territories that are no longer beneath a selected sector", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([sectorTwoTerritory.id]);
  });

  it("drops a selected territory reparented out of the selected sector on refetch", () => {
    const { rerender } = render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(latestResultQuery()?.parentOrgIds).toEqual([secondTerritory.id]);

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritory.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="area" />);

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      sectorOne.id,
      territory.id,
    ]);
    expect(screen.queryByTestId(`territory-${secondTerritory.id}`)).toBeNull();
  });

  it("does not restore a dropped territory when the sector selection is cleared", () => {
    const { rerender } = render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritory.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="area" />);
    expect(latestResultQuery()?.parentOrgIds).toEqual([
      sectorOne.id,
      territory.id,
    ]);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("drops a selected territory that is deactivated on refetch", () => {
    const { rerender } = render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(latestResultQuery()?.parentOrgIds).toEqual([secondTerritory.id]);

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritory.id ? { ...org, isActive: false } : org,
    );
    rerender(<OrgTable orgType="area" />);

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("keeps a selected territory while its hierarchy is momentarily unavailable", () => {
    const { rerender } = render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));

    mocks.hierarchyAvailable = false;
    rerender(<OrgTable orgType="area" />);
    expect(latestResultQuery()?.parentOrgIds).toEqual([secondTerritory.id]);

    mocks.hierarchyAvailable = true;
    rerender(<OrgTable orgType="area" />);
    expect(latestResultQuery()?.parentOrgIds).toEqual([secondTerritory.id]);
  });

  it("resets territory selections with the other filters", () => {
    render(<OrgTable orgType="area" />);

    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId("reset-filters"));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("shows both the territory and the sector for an area under a territory", () => {
    mocks.resultOrgs = [secondTerritoryArea];
    render(<OrgTable orgType="area" />);

    const data = screen.getByTestId("table-data").textContent;
    expect(data).toContain('"territory":"Second Territory"');
    expect(data).toContain('"sector":"Sector One"');
  });

  it("shows the sector and no territory for an area directly under a sector", () => {
    mocks.resultOrgs = [directArea];
    render(<OrgTable orgType="area" />);

    const data = screen.getByTestId("table-data").textContent;
    expect(data).toContain('"sector":"Sector One"');
    expect(data).not.toContain('"territory"');
  });

  it("resolves the sector through an inactive territory", () => {
    mocks.resultOrgs = [nestedArea];
    render(<OrgTable orgType="area" />);

    const data = screen.getByTestId("table-data").textContent;
    expect(data).toContain('"territory":"Territory"');
    expect(data).toContain('"sector":"Sector One"');
  });
});

describe("Region Sector, Territory and Area filter intersections", () => {
  const inactiveNestedArea = { ...inactiveArea, parentId: secondTerritory.id };
  const sectorTwoTerritoryArea = {
    ...secondSectorArea,
    id: 17,
    parentId: sectorTwoTerritory.id,
    name: "Sector Two Territory Area",
  };
  const directTerritoryRegion = {
    ...nestedRegion,
    id: 16,
    parentId: secondTerritory.id,
    name: "Direct Territory Region",
  };

  beforeEach(() => {
    mocks.hierarchyAvailable = true;
    mocks.hierarchyOrgs = [
      nation,
      sectorOne,
      territory,
      nestedArea,
      directArea,
      sectorTwo,
      secondSectorArea,
      inactiveNestedArea,
      secondTerritory,
      secondTerritoryArea,
      sectorTwoTerritory,
      sectorTwoTerritoryArea,
      inactiveSector,
    ];
    mocks.queryInputs = [];
    mocks.resultOrgs = [];
  });

  it("leaves hierarchy unfiltered until a tier is selected and exposes each tier independently", () => {
    render(<OrgTable orgType="region" />);
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
    expect(screen.getByTestId(`sector-${sectorOne.id}`)).toBeTruthy();
    expect(screen.getByTestId(`territory-${secondTerritory.id}`)).toBeTruthy();
    expect(screen.getByTestId(`area-${secondTerritoryArea.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`territory-${territory.id}`)).toBeNull();
    expect(screen.queryByTestId(`area-${inactiveNestedArea.id}`)).toBeNull();
  });

  it("includes direct Territory, Area and inactive-intermediate parents under a Sector", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    expectParentIds(
      sectorOne.id,
      territory.id,
      nestedArea.id,
      directArea.id,
      inactiveNestedArea.id,
      secondTerritory.id,
      secondTerritoryArea.id,
    );
  });

  it("selects both branches of a Territory and narrows them when an Area is also selected", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expectParentIds(
      secondTerritory.id,
      secondTerritoryArea.id,
      inactiveNestedArea.id,
    );

    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    expectParentIds(secondTerritoryArea.id);

    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    expectParentIds(
      secondTerritory.id,
      secondTerritoryArea.id,
      inactiveNestedArea.id,
    );
  });

  it("keeps a Territory with no Areas as a result parent without offering unrelated Areas", () => {
    mocks.hierarchyOrgs = mocks.hierarchyOrgs.filter(
      (org) => org.id !== sectorTwoTerritoryArea.id,
    );
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));

    expect(screen.queryAllByTestId(/^area-/)).toHaveLength(0);
    expectParentIds(sectorTwoTerritory.id);
  });

  it("uses OR within Territory and Area selections and AND between the tiers", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    expectParentIds(
      secondTerritory.id,
      secondTerritoryArea.id,
      inactiveNestedArea.id,
      sectorTwoTerritory.id,
      sectorTwoTerritoryArea.id,
    );

    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${sectorTwoTerritoryArea.id}`));
    expectParentIds(secondTerritoryArea.id, sectorTwoTerritoryArea.id);

    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expectParentIds(sectorTwoTerritoryArea.id);
    expect(screen.queryByTestId(`area-${secondTerritoryArea.id}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    expectParentIds(sectorTwoTerritoryArea.id);
    expect(
      screen
        .getByTestId(`area-${secondTerritoryArea.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("narrows Areas to selected Territories without narrowing Territory choices by Area", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`area-${secondSectorArea.id}`));
    expect(screen.getByTestId(`territory-${secondTerritory.id}`)).toBeTruthy();
    expect(
      screen.getByTestId(`territory-${sectorTwoTerritory.id}`),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));

    expect(screen.queryByTestId(`area-${secondSectorArea.id}`)).toBeNull();
    expect(screen.queryByTestId(`area-${directArea.id}`)).toBeNull();
    expect(
      screen.queryByTestId(`area-${sectorTwoTerritoryArea.id}`),
    ).toBeNull();
    expect(screen.getByTestId(`area-${secondTerritoryArea.id}`)).toBeTruthy();
    expectParentIds(
      secondTerritory.id,
      secondTerritoryArea.id,
      inactiveNestedArea.id,
    );

    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    expect(
      screen.getByTestId(`territory-${sectorTwoTerritory.id}`),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    expect(
      screen.getByTestId(`area-${sectorTwoTerritoryArea.id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId(`area-${secondSectorArea.id}`)).toBeNull();
    expectParentIds(secondTerritoryArea.id);
  });

  it("restores Sector-scoped Area choices when Territories clear without restoring pruned selections", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${directArea.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(screen.queryByTestId(`area-${directArea.id}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(screen.getByTestId(`area-${nestedArea.id}`)).toBeTruthy();
    expect(
      screen.getByTestId(`area-${directArea.id}`).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.queryByTestId(`area-${secondSectorArea.id}`)).toBeNull();
    expectParentIds(
      sectorOne.id,
      territory.id,
      nestedArea.id,
      directArea.id,
      inactiveNestedArea.id,
      secondTerritory.id,
      secondTerritoryArea.id,
    );

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    expect(screen.getByTestId(`area-${secondSectorArea.id}`)).toBeTruthy();
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("prunes both lower tiers by remaining Sectors and preserves them when the last Sector clears", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId("select-first-two-sectors"));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`territory-${sectorTwoTerritory.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${sectorTwoTerritoryArea.id}`));
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(screen.queryByTestId(`territory-${secondTerritory.id}`)).toBeNull();
    expect(screen.queryByTestId(`area-${secondTerritoryArea.id}`)).toBeNull();
    expectParentIds(sectorTwoTerritoryArea.id);
    fireEvent.click(screen.getByTestId(`area-${sectorTwoTerritoryArea.id}`));
    expectParentIds(sectorTwoTerritory.id, sectorTwoTerritoryArea.id);
    fireEvent.click(screen.getByTestId(`sector-${sectorTwo.id}`));
    expectParentIds(sectorTwoTerritory.id, sectorTwoTerritoryArea.id);
    expect(
      screen
        .getByTestId(`territory-${sectorTwoTerritory.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByTestId(`territory-${secondTerritory.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("drops reparented selections on refetch without restoring them when the Sector clears", () => {
    const { rerender } = render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritory.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="region" />);
    expectParentIds(sectorOne.id, territory.id, nestedArea.id, directArea.id);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
    expect(
      screen
        .getByTestId(`territory-${secondTerritory.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByTestId(`area-${secondTerritoryArea.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("drops a deactivated Territory selection while its active Area selection remains", () => {
    const { rerender } = render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritory.id ? { ...org, isActive: false } : org,
    );
    rerender(<OrgTable orgType="region" />);
    expect(screen.queryByTestId(`territory-${secondTerritory.id}`)).toBeNull();
    expectParentIds(secondTerritoryArea.id);
    expect(
      screen
        .getByTestId(`area-${secondTerritoryArea.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("prunes an Area moved outside selected Territories on refetch without restoring its selection", () => {
    const { rerender } = render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === secondTerritoryArea.id
        ? { ...org, parentId: sectorTwoTerritory.id }
        : org,
    );
    rerender(<OrgTable orgType="region" />);

    expect(screen.queryByTestId(`area-${secondTerritoryArea.id}`)).toBeNull();
    expectParentIds(secondTerritory.id, inactiveNestedArea.id);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    expect(
      screen
        .getByTestId(`area-${secondTerritoryArea.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });

  it("fails closed while hierarchy is unavailable and restores retained selections after loading", () => {
    const { rerender } = render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId(`territory-${secondTerritory.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondTerritoryArea.id}`));
    mocks.hierarchyAvailable = false;
    rerender(<OrgTable orgType="region" />);
    expectParentIds(-1);

    mocks.hierarchyAvailable = true;
    rerender(<OrgTable orgType="region" />);
    expectParentIds(secondTerritoryArea.id);
    expect(
      screen
        .getByTestId(`territory-${secondTerritory.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByTestId(`area-${secondTerritoryArea.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("resets the page on each hierarchy change while retaining search, status and Only Mine", () => {
    render(<OrgTable orgType="region" />);
    fireEvent.click(screen.getByTestId("search"));
    fireEvent.click(screen.getByTestId("inactive-all"));
    for (const id of [
      `sector-${sectorOne.id}`,
      `territory-${secondTerritory.id}`,
      `area-${secondTerritoryArea.id}`,
    ]) {
      fireEvent.click(screen.getByTestId("next-page"));
      expect(latestResultQuery()?.pageIndex).toBe(2);
      fireEvent.click(screen.getByTestId(id));
      expect(latestResultQuery()).toMatchObject({
        pageIndex: 0,
        pageSize: 50,
        searchTerm: "needle",
        statuses: ["inactive"],
      });
      expect(latestResultQuery()?.onlyMine).toBeUndefined();
    }
    fireEvent.click(screen.getByTestId("reset-filters"));
    expect(latestResultQuery()).toMatchObject({
      pageIndex: 0,
      pageSize: 50,
      searchTerm: "needle",
      statuses: ["active"],
      onlyMine: true,
    });
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
    expect(
      screen
        .getByTestId(`territory-${secondTerritory.id}`)
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows a blank Area and resolves Sector for a direct Territory Region", () => {
    mocks.resultOrgs = [directTerritoryRegion];
    render(<OrgTable orgType="region" />);
    const rows: unknown = JSON.parse(
      screen.getByTestId("table-data").textContent,
    );
    expect(rows).toEqual([
      { ...directTerritoryRegion, sector: sectorOne.name },
    ]);
  });
});

describe("Area display through persisted intermediate Areas", () => {
  beforeEach(() => {
    mocks.hierarchyAvailable = true;
    mocks.queryInputs = [];
  });

  it.each(["sector", "territory"] as const)(
    "resolves %s through an inactive Area outside the current result page",
    (ancestorType) => {
      const ancestor = {
        id: 900,
        parentId: null,
        orgType: ancestorType,
        name: "Resolved ancestor",
        isActive: true,
      };
      const intermediate = {
        id: 901,
        parentId: 900,
        orgType: "area",
        name: "Off-page Area",
        isActive: false,
      };
      const row = {
        id: 902,
        parentId: 901,
        orgType: "area",
        name: "Visible Area",
        isActive: true,
      };
      mocks.hierarchyOrgs = [ancestor, intermediate];
      mocks.resultOrgs = [row];
      render(<OrgTable orgType="area" />);
      expect(JSON.parse(screen.getByTestId("table-data").textContent)).toEqual([
        { ...row, [ancestorType]: ancestor.name },
      ]);
      if (ancestorType === "sector") {
        fireEvent.click(screen.getByTestId("sector-900"));
        expect(latestResultQuery()?.parentOrgIds).toEqual([900]);
      }
    },
  );

  it.each([20, 21])(
    "keeps the display depth limit with %i Area parent edges",
    (depth) => {
      const ancestor = {
        id: 900,
        parentId: null,
        orgType: "sector",
        name: "Boundary Sector",
        isActive: true,
      };
      const intermediates = Array.from({ length: depth - 1 }, (_, i) => ({
        id: i + 1,
        parentId: i === depth - 2 ? ancestor.id : i + 2,
        orgType: "area",
        name: "Intermediate",
        isActive: true,
      }));
      const row = {
        id: 902,
        parentId: 1,
        orgType: "area",
        name: "Visible Area",
        isActive: true,
      };
      mocks.hierarchyOrgs = [ancestor, ...intermediates];
      mocks.resultOrgs = [row];
      render(<OrgTable orgType="area" />);
      expect(JSON.parse(screen.getByTestId("table-data").textContent)).toEqual([
        depth === 20 ? { ...row, sector: ancestor.name } : row,
      ]);
    },
  );
});
