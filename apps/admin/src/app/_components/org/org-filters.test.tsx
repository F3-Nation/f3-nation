import { fireEvent, render, screen } from "@testing-library/react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryInput {
  orgTypes: string[];
  pageIndex?: number;
  parentOrgIds?: number[];
  statuses?: ("active" | "inactive")[];
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
  useQuery: ({ input }: { input: QueryInput }) => {
    mocks.queryInputs.push(input);

    const isResultQuery =
      input.orgTypes.length === 1 &&
      (input.orgTypes[0] === "region" || input.pageIndex !== undefined);

    if (!isResultQuery && !mocks.hierarchyAvailable) return { data: undefined };

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
  },
}));

vi.mock("@acme/ui/md-table", async () => {
  const React = await vi.importActual<typeof ReactModule>("react");

  return {
    MDTable: ({
      data,
      filterComponent,
    }: {
      data: TestOrg[] | undefined;
      filterComponent: React.ReactNode;
    }) => (
      <div>
        <output data-testid="table-data">{JSON.stringify(data)}</output>
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
  }: {
    areas: TestOrg[] | undefined;
    onAreaSelect: (area: TestOrg) => void;
  }) => (
    <div>
      {areas?.map((area) => (
        <button
          key={area.id}
          data-testid={`area-${area.id}`}
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
  }: {
    territories: TestOrg[] | undefined;
    onTerritorySelect: (territory: TestOrg) => void;
  }) => (
    <div>
      {territories?.map((territory) => (
        <button
          key={territory.id}
          data-testid={`territory-${territory.id}`}
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
vi.mock("../status-filter", () => ({ StatusFilter: () => null }));
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

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      nestedArea.id,
      directArea.id,
    ]);
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

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      nestedArea.id,
      directArea.id,
      secondSectorArea.id,
    ]);
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

    expect(latestResultQuery()?.parentOrgIds).toEqual([directArea.id]);
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

    expect(latestResultQuery()?.parentOrgIds).toEqual([directArea.id]);
  });

  it("does not restore a dropped area when the sector selection is cleared", () => {
    const { rerender } = render(<OrgTable orgType="region" />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === nestedArea.id ? { ...org, parentId: sectorTwo.id } : org,
    );
    rerender(<OrgTable orgType="region" />);
    expect(latestResultQuery()?.parentOrgIds).toEqual([directArea.id]);

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
