import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestOrg {
  id: number;
  parentId: number | null;
  name: string;
  orgType: string;
  isActive: boolean;
}
interface QueryInput {
  orgTypes: string[];
  statuses?: string[];
  parentOrgIds?: number[];
  pageIndex: number;
  pageSize: number;
}

const mocks = vi.hoisted(() => ({
  all: vi.fn<
    (input: QueryInput) => Promise<{ orgs: TestOrg[]; total: number }>
  >(),
}));

// Keep React Query, the hierarchy paging hook and OrgTable real. The API
// double applies only immediate-parent filtering, like the existing contract.
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  orpc: {
    org: {
      all: {
        queryOptions: ({ input }: { input: QueryInput }) => ({
          queryKey: ["org", "all", input],
          queryFn: () => mocks.all(input),
        }),
      },
    },
  },
}));
vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: QueryInput) => mocks.all(input) } },
}));
vi.mock("~/utils/store/modal", () => ({
  DeleteType: { ORG: "org" },
  ModalType: {
    ADMIN_ORG: "admin-org",
    ADMIN_DELETE_CONFIRMATION: "delete-org",
  },
  openModal: vi.fn(),
}));
vi.mock("@acme/ui/md-table", async () => {
  const React = await vi.importActual<typeof ReactModule>("react");
  return {
    usePagination: () => {
      const [pagination, setPagination] = React.useState({
        pageIndex: 0,
        pageSize: 2,
      });
      return { pagination, setPagination };
    },
    MDTable: ({
      data,
      totalCount,
      pagination,
      setPagination,
      filterComponent,
    }: {
      data?: TestOrg[];
      totalCount?: number;
      pagination: { pageIndex: number; pageSize: number };
      setPagination: ReactModule.Dispatch<
        ReactModule.SetStateAction<{ pageIndex: number; pageSize: number }>
      >;
      filterComponent: ReactModule.ReactNode;
    }) => (
      <div>
        <output data-testid="region-results">
          {JSON.stringify(data ?? [])}
        </output>
        <output data-testid="region-total">{totalCount}</output>
        <output data-testid="region-page">{pagination.pageIndex}</output>
        <button
          onClick={() =>
            setPagination((previous) => ({
              ...previous,
              pageIndex: previous.pageIndex + 1,
            }))
          }
        >
          Next Region page
        </button>
        {filterComponent}
      </div>
    ),
  };
});
vi.mock("./sector-filter", () => ({
  SectorFilter: ({
    sectors,
    selectedSectors,
    onSectorSelect,
  }: {
    sectors?: TestOrg[];
    selectedSectors: TestOrg[];
    onSectorSelect: (org: TestOrg) => void;
  }) =>
    sectors?.map((org) => (
      <button
        key={org.id}
        aria-pressed={selectedSectors.some(
          (selected) => selected.id === org.id,
        )}
        onClick={() => onSectorSelect(org)}
      >
        Sector: {org.name}
      </button>
    )),
}));
vi.mock("./territory-filter", () => ({
  TerritoryFilter: ({
    territories,
    selectedTerritories,
    onTerritorySelect,
  }: {
    territories?: TestOrg[];
    selectedTerritories: TestOrg[];
    onTerritorySelect: (org: TestOrg) => void;
  }) =>
    territories?.map((org) => (
      <button
        key={org.id}
        aria-pressed={selectedTerritories.some(
          (selected) => selected.id === org.id,
        )}
        onClick={() => onTerritorySelect(org)}
      >
        Territory: {org.name}
      </button>
    )),
}));
vi.mock("./area-filter", () => ({
  AreaFilter: ({
    areas,
    selectedAreas,
    onAreaSelect,
  }: {
    areas?: TestOrg[];
    selectedAreas: TestOrg[];
    onAreaSelect: (org: TestOrg) => void;
  }) =>
    areas?.map((org) => (
      <button
        key={org.id}
        aria-pressed={selectedAreas.some((selected) => selected.id === org.id)}
        onClick={() => onAreaSelect(org)}
      >
        Area: {org.name}
      </button>
    )),
}));
vi.mock("../status-filter", () => ({ StatusFilter: () => null }));

import { OrgTable } from "./org-table";

const node = (
  id: number,
  parentId: number | null,
  orgType: string,
  name: string,
  isActive = true,
): TestOrg => ({ id, parentId, orgType, name, isActive });
const hierarchy = [
  node(1, null, "nation", "Nation"),
  node(2, 1, "sector", "Selected Sector"),
  node(6, 1, "sector", "Other Sector"),
  node(3, 2, "territory", "Inactive Territory", false),
  node(4, 3, "area", "Area Through Inactive Territory"),
  node(5, 2, "area", "Direct Sector Area"),
  node(8, 13, "area", "Inactive Area", false),
  ...Array.from({ length: 93 }, (_, index) =>
    node(1000 + index, 6, "area", `Unrelated Area ${index}`),
  ),
  // These matching ancestors live beyond the first 100-row hierarchy page.
  node(13, 2, "territory", "Paged Territory"),
  node(14, 13, "area", "Paged Area"),
  node(15, 6, "territory", "Other Territory"),
  node(7, 15, "area", "Other Area"),
];
const regions = [
  node(9, 4, "region", "Through Inactive Territory"),
  node(12, 8, "region", "Through Inactive Area"),
  node(16, 13, "region", "Direct Territory Region"),
  node(17, 14, "region", "Area Region"),
  node(18, 5, "region", "Direct Sector Area Region"),
  node(19, 7, "region", "Other Region"),
];
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.all.mockReset();
  mocks.all.mockImplementation(async (input) => {
    const isRegionQuery =
      input.orgTypes.length === 1 && input.orgTypes[0] === "region";
    const eligible = (isRegionQuery ? regions : hierarchy).filter(
      (org) =>
        input.orgTypes.includes(org.orgType) &&
        (input.statuses ?? ["active"]).includes(
          org.isActive ? "active" : "inactive",
        ) &&
        (!input.parentOrgIds?.length ||
          input.parentOrgIds.includes(org.parentId ?? -1)),
    );
    const start = input.pageIndex * input.pageSize;
    return {
      orgs: eligible.slice(start, start + input.pageSize),
      total: eligible.length,
    };
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgTable orgType="region" />
    </QueryClientProvider>,
  );
}
const rowIds = () =>
  (
    JSON.parse(screen.getByTestId("region-results").textContent) as TestOrg[]
  ).map((org) => org.id);
const latestRegionInput = () =>
  [...mocks.all.mock.calls]
    .reverse()
    .find(([input]) => input.orgTypes[0] === "region")?.[0];

describe("Region filters with real hierarchy paging", () => {
  it.each(["desktop", "mobile"])(
    "filters both Territory branches before Region pagination through %s controls",
    async (surface) => {
      mount();
      await screen.findByRole("button", { name: "Territory: Paged Territory" });
      expect(mocks.all).toHaveBeenCalledWith({
        orgTypes: ["area", "territory", "sector", "nation"],
        statuses: ["active", "inactive"],
        pageIndex: 1,
        pageSize: 100,
      });
      fireEvent.click(screen.getByRole("button", { name: "Next Region page" }));
      await waitFor(() => expect(latestRegionInput()?.pageIndex).toBe(1));

      if (surface === "mobile")
        fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
      const controls =
        surface === "mobile" ? within(screen.getByRole("dialog")) : screen;
      expect(
        controls.getByRole("button", { name: "Sector: Selected Sector" }),
      ).toBeTruthy();
      expect(
        controls.getByRole("button", { name: "Area: Paged Area" }),
      ).toBeTruthy();
      fireEvent.click(
        controls.getByRole("button", { name: "Territory: Paged Territory" }),
      );

      await waitFor(() => expect(rowIds()).toEqual([12, 16]));
      expect(screen.getByTestId("region-total").textContent).toBe("3");
      expect(screen.getByTestId("region-page").textContent).toBe("0");
      expect(latestRegionInput()).toMatchObject({
        pageIndex: 0,
        pageSize: 2,
      });
      expect(latestRegionInput()?.parentOrgIds).toEqual(
        expect.arrayContaining([8, 13, 14]),
      );
      expect(
        controls.queryByRole("button", { name: "Area: Inactive Area" }),
      ).toBeNull();
      expect(
        controls.queryByRole("button", { name: "Area: Other Area" }),
      ).toBeNull();
      expect(
        controls.queryByRole("button", { name: "Area: Direct Sector Area" }),
      ).toBeNull();
      expect(
        controls.queryByRole("button", {
          name: "Territory: Inactive Territory",
        }),
      ).toBeNull();

      if (surface === "desktop") {
        fireEvent.click(
          screen.getByRole("button", { name: "Next Region page" }),
        );
        await waitFor(() => expect(rowIds()).toEqual([17]));
        expect(screen.getByTestId("region-total").textContent).toBe("3");
      }
      fireEvent.click(
        controls.getByRole("button", { name: "Area: Paged Area" }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("region-total").textContent).toBe("1"),
      );
      expect(rowIds()).toEqual([17]);
      expect(latestRegionInput()).toMatchObject({
        pageIndex: 0,
        parentOrgIds: [14],
      });
    },
  );

  it("prunes incompatible Areas when a Territory is selected and restores their choices when it clears", async () => {
    mount();
    await screen.findByRole("button", { name: "Territory: Paged Territory" });
    fireEvent.click(screen.getByRole("button", { name: "Area: Other Area" }));
    await waitFor(() => expect(rowIds()).toEqual([19]));
    fireEvent.click(
      screen.getByRole("button", { name: "Territory: Paged Territory" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("region-total").textContent).toBe("3"),
    );
    expect(rowIds()).toEqual([12, 16]);
    expect(latestRegionInput()?.parentOrgIds).toEqual(
      expect.arrayContaining([8, 13, 14]),
    );
    expect(
      screen
        .getByRole("button", { name: "Territory: Paged Territory" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.queryByRole("button", { name: "Area: Other Area" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Area: Paged Area" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Territory: Other Territory" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Territory: Paged Territory" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("region-total").textContent).toBe("6"),
    );
    expect(latestRegionInput()?.parentOrgIds).toBeUndefined();
    expect(
      screen
        .getByRole("button", { name: "Area: Other Area" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("offers Areas from any selected Territory and prunes only the deselected Territory's Areas", async () => {
    mount();
    await screen.findByRole("button", { name: "Territory: Paged Territory" });
    fireEvent.click(
      screen.getByRole("button", { name: "Territory: Paged Territory" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Territory: Other Territory" }),
    );
    expect(
      screen.getByRole("button", { name: "Area: Paged Area" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Area: Other Area" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Area: Direct Sector Area" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Area: Paged Area" }));
    fireEvent.click(screen.getByRole("button", { name: "Area: Other Area" }));
    await waitFor(() => expect(rowIds()).toEqual([17, 19]));
    expect(screen.getByTestId("region-total").textContent).toBe("2");

    fireEvent.click(
      screen.getByRole("button", { name: "Territory: Paged Territory" }),
    );
    await waitFor(() => expect(rowIds()).toEqual([19]));
    expect(screen.getByTestId("region-total").textContent).toBe("1");
    expect(
      screen.queryByRole("button", { name: "Area: Paged Area" }),
    ).toBeNull();
    expect(latestRegionInput()?.parentOrgIds).toEqual([7]);
  });

  it("matches all three Sector branch shapes through inactive and off-first-page ancestors", async () => {
    mount();
    await screen.findByRole("button", { name: "Territory: Paged Territory" });
    fireEvent.click(
      screen.getByRole("button", { name: "Sector: Selected Sector" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("region-total").textContent).toBe("5"),
    );
    expect(rowIds()).toEqual([9, 12]);
    expect(latestRegionInput()?.parentOrgIds).toEqual(
      expect.arrayContaining([3, 4, 5, 8, 13, 14]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next Region page" }));
    await waitFor(() => expect(rowIds()).toEqual([16, 17]));
    fireEvent.click(screen.getByRole("button", { name: "Next Region page" }));
    await waitFor(() => expect(rowIds()).toEqual([18]));
    expect(screen.getByTestId("region-total").textContent).toBe("5");
  });
});
