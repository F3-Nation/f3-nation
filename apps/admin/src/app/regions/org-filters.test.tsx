import { fireEvent, render, screen } from "@testing-library/react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedEnumsModule from "@acme/shared/app/enums";

interface QueryInput {
  orgTypes: string[];
  pageIndex?: number;
  parentOrgIds?: number[];
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

vi.mock("@acme/shared/app/enums", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedEnumsModule>();

  return {
    ...actual,
    OrgType: [...actual.OrgType, "territory"],
  };
});

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
          : mocks.hierarchyOrgs.filter((org) =>
              input.orgTypes.includes(org.orgType),
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
vi.mock("../_components/mobile-filter-sheet", () => ({
  MobileFilterSheet: () => null,
}));
vi.mock("../_components/reset-filter", () => ({ ResetFilter: () => null }));
vi.mock("../_components/status-filter", () => ({ StatusFilter: () => null }));
vi.mock("~/utils/store/modal", () => ({
  DeleteType: { REGION: "region", AREA: "area" },
  ModalType: {
    ADMIN_AREAS: "admin-areas",
    ADMIN_DELETE_CONFIRMATION: "admin-delete-confirmation",
    ADMIN_REGIONS: "admin-regions",
  },
  openModal: vi.fn(),
}));

import { AreasTable } from "../areas/areas-table";
import { RegionsTable } from "./regions-table";

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
const subTerritory: TestOrg = {
  id: 10,
  parentId: territory.id,
  name: "Sub-territory",
  orgType: "territory",
  isActive: true,
};
const nestedArea: TestOrg = {
  id: 4,
  parentId: subTerritory.id,
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
      subTerritory,
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
    render(<RegionsTable />);

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
    render(<RegionsTable />);

    expect(screen.getByTestId("table-data").textContent).toContain(
      '"area":"Inactive Area"',
    );
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"sector":"Sector One"',
    );
  });

  it("retains both selections when sector callbacks occur before a render", () => {
    render(<RegionsTable />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      nestedArea.id,
      directArea.id,
      secondSectorArea.id,
    ]);
  });

  it("gives directly selected areas priority over sector-derived areas", () => {
    render(<RegionsTable />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([nestedArea.id]);
  });

  it("prunes selected areas when their sector is deselected", () => {
    render(<RegionsTable />);

    fireEvent.click(screen.getByTestId("select-first-two-sectors"));
    fireEvent.click(screen.getByTestId(`area-${nestedArea.id}`));
    fireEvent.click(screen.getByTestId(`area-${secondSectorArea.id}`));
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([secondSectorArea.id]);
  });

  it("filters areas through a territory parent", () => {
    mocks.resultOrgs = [nestedArea];
    render(<AreasTable />);

    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toEqual([
      sectorOne.id,
      territory.id,
      subTerritory.id,
    ]);
    expect(screen.getByTestId("table-data").textContent).toContain(
      '"sector":"Sector One"',
    );
    expect(mocks.queryInputs[0]?.orgTypes).toEqual([
      "sector",
      "nation",
      "territory",
    ]);
  });

  it("keeps the area query fail-closed while hierarchy data is unavailable", () => {
    const { rerender } = render(<AreasTable />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    mocks.hierarchyAvailable = false;
    rerender(<AreasTable />);

    expect(latestResultQuery()?.parentOrgIds).toEqual([-1]);
  });

  it("deselects an area-table sector after a refetch replaces its object", () => {
    const { rerender } = render(<AreasTable />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    mocks.hierarchyOrgs = mocks.hierarchyOrgs.map((org) =>
      org.id === sectorOne.id ? { ...org } : org,
    );
    rerender(<AreasTable />);
    fireEvent.click(screen.getByTestId(`sector-${sectorOne.id}`));

    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();
  });
});
