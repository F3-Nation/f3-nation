import { fireEvent, render, screen } from "@testing-library/react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgType } from "@acme/shared/app/enums";

interface PositionQueryInput {
  isActive?: boolean;
  orgType?: OrgType;
  statuses?: string[];
  onlyMine?: boolean;
  searchTerm?: string;
  pageSize?: number;
  pageIndex?: number;
}

interface TestPosition {
  id: number;
  name: string;
  description: string | null;
  orgId: number | null;
  orgName: string | null;
  orgType: OrgType | null;
  isActive: boolean;
  created: string;
  updated: string;
}

const mocks = vi.hoisted(() => ({
  isNationAdmin: true,
  positions: [] as TestPosition[],
  accessibleOrgIds: [] as number[],
  queryInputs: [] as PositionQueryInput[],
}));

vi.mock("~/orpc/react", () => ({
  orpc: {
    position: {
      all: {
        queryOptions: ({ input }: { input: PositionQueryInput }) => ({
          __key: "position.all" as const,
          input,
        }),
      },
    },
    org: {
      accessible: {
        queryOptions: () => ({ __key: "org.accessible" as const }),
      },
    },
  },
  useQuery: (
    options:
      | { __key: "position.all"; input: PositionQueryInput }
      | { __key: "org.accessible" },
  ) => {
    if (options.__key === "org.accessible") {
      return {
        data: {
          orgs: mocks.accessibleOrgIds.map((id) => ({
            id,
            name: `Org ${id}`,
            orgType: "region" as const,
            parentId: null,
            roles: [],
          })),
          total: mocks.accessibleOrgIds.length,
        },
      };
    }

    mocks.queryInputs.push(options.input);
    return {
      data: { positions: mocks.positions, totalCount: mocks.positions.length },
    };
  },
}));

vi.mock("~/utils/hooks/use-auth", () => ({
  useAuth: () => ({ isNationAdmin: mocks.isNationAdmin }),
}));

vi.mock("~/utils/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("~/utils/store/modal", () => ({
  DeleteType: { POSITION: "position" },
  ModalType: {
    ADMIN_POSITIONS: "admin-positions",
    ADMIN_DELETE_CONFIRMATION: "admin-delete-confirmation",
  },
  openModal: vi.fn(),
}));

vi.mock("../_components/status-filter", () => ({ StatusFilter: () => null }));
vi.mock("../_components/reset-filter", () => ({
  ResetFilter: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="reset-filters" onClick={onClick}>
      Reset
    </button>
  ),
}));
// Stubbed to render nothing (rather than its children) so the org-level
// filter — which the desktop filter row also renders — doesn't appear
// twice and collide on duplicate data-testids.
vi.mock("../_components/mobile-filter-sheet", () => ({
  MobileFilterSheet: () => null,
}));

vi.mock("@acme/ui/select", async () => {
  const React = await vi.importActual<typeof ReactModule>("react");
  const SelectContext = React.createContext<{
    onValueChange: (value: string) => void;
  } | null>(null);

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div data-testid="org-level-select" data-value={value}>
          {children}
        </div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const ctx = React.useContext(SelectContext);
      return (
        <button
          type="button"
          data-testid={`org-level-option-${value || "all"}`}
          onClick={() => ctx?.onValueChange(value)}
        >
          {children}
        </button>
      );
    },
  };
});

// Renders just enough of MDTable to exercise the columns this test cares
// about — the real table comes from @tanstack/react-table's flexRender,
// which needs a full column-def/row-model setup this mock doesn't recreate.
vi.mock("@acme/ui/md-table", async () => {
  const React = await vi.importActual<typeof ReactModule>("react");

  return {
    MDTable: ({
      data,
      columns,
      filterComponent,
    }: {
      data: TestPosition[] | undefined;
      columns: {
        accessorKey?: string;
        cell?: (context: {
          row: { original: TestPosition };
        }) => React.ReactNode;
      }[];
      filterComponent: React.ReactNode;
    }) => {
      const orgTypeColumn = columns.find(
        (column) => column.accessorKey === "orgType",
      );

      return (
        <div>
          {filterComponent}
          <div data-testid="rows">
            {data?.map((position) => (
              <div key={position.id} data-testid={`row-${position.id}`}>
                {orgTypeColumn?.cell?.({ row: { original: position } })}
              </div>
            ))}
          </div>
        </div>
      );
    },
    usePagination: () => {
      const [pagination, setPagination] = React.useState({
        pageIndex: 0,
        pageSize: 20,
      });
      return { pagination, setPagination };
    },
  };
});

import { PositionsTable } from "./positions-table";

const regionalPosition: TestPosition = {
  id: 1,
  name: "Regional Q",
  description: null,
  orgId: 5,
  orgName: "Some Region",
  orgType: "region",
  isActive: true,
  created: "2026-01-01",
  updated: "2026-01-01",
};
const nationalPosition: TestPosition = {
  id: 2,
  name: "Nation Director",
  description: null,
  orgId: null,
  orgName: null,
  orgType: null,
  isActive: true,
  created: "2026-01-01",
  updated: "2026-01-01",
};

const latestPositionQuery = () =>
  mocks.queryInputs[mocks.queryInputs.length - 1];

describe("PositionsTable org-level filter and column (single source of truth org hierarchy)", () => {
  beforeEach(() => {
    mocks.isNationAdmin = true;
    mocks.positions = [regionalPosition, nationalPosition];
    mocks.accessibleOrgIds = [];
    mocks.queryInputs = [];
  });

  it("renders one filter option per OrgType, in hierarchy order, using orgTypeDisplay's labels", () => {
    render(<PositionsTable />);

    const select = screen.getByTestId("org-level-select");
    const optionLabels = Array.from(select.querySelectorAll("button")).map(
      (button) => button.textContent,
    );

    expect(optionLabels).toEqual([
      "All Levels",
      "AO",
      "Region",
      "Area",
      "Sector",
      "Nation",
    ]);
  });

  it("renders the org-type column using orgTypeDisplay's label, falling back to 'All' for nation-wide positions", () => {
    render(<PositionsTable />);

    expect(screen.getByTestId(`row-${regionalPosition.id}`).textContent).toBe(
      "Region",
    );
    expect(screen.getByTestId(`row-${nationalPosition.id}`).textContent).toBe(
      "All",
    );
  });

  it("filters by the selected OrgType value when an org-level option is chosen", () => {
    render(<PositionsTable />);

    fireEvent.click(screen.getByTestId("org-level-option-sector"));

    expect(latestPositionQuery()?.orgType).toBe("sector");
  });

  it("clears the org-level filter when 'All Levels' is re-selected", () => {
    render(<PositionsTable />);

    fireEvent.click(screen.getByTestId("org-level-option-sector"));
    fireEvent.click(screen.getByTestId("org-level-option-all"));

    expect(latestPositionQuery()?.orgType).toBeUndefined();
  });
});
