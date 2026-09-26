import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { flexRender, useTable } from "@tanstack/react-table";
import type {
  ColumnDef,
  OnChangeFn,
  SortingState,
} from "@tanstack/react-table";
import type { RouterOutputs } from "~/orpc/types";
import { OrgType } from "@acme/shared/app/enums";
import {
  ORG_TREE_MAX_DEPTH,
  orgTypeDisplay,
} from "@acme/shared/app/org-hierarchy";
import { OrgTable } from "./org-table";
import type * as MDTableModule from "@acme/ui/md-table";
import type { MdTableFeatures } from "@acme/ui/table-features";
import { mdTableFeatures } from "@acme/ui/table-features";

const mocks = vi.hoisted(
  (): {
    inputs: Record<string, unknown>[];
    orgs: ({ orgType: string } & Record<string, unknown>)[];
    props: Record<string, unknown>;
    open: ReturnType<typeof vi.fn>;
  } => ({
    inputs: [] as Record<string, unknown>[],
    orgs: [],
    props: {},
    open: vi.fn(),
  }),
);
vi.mock("~/orpc/react", () => ({
  orpc: { org: { all: { queryOptions: (options: unknown) => options } } },
  useQuery: ({
    input,
    enabled,
  }: {
    input: Record<string, unknown>;
    enabled?: boolean;
  }) => {
    if (enabled === false) return {};
    mocks.inputs.push(input);
    const orgTypes = (input.orgTypes ?? []) as string[];
    return {
      data: {
        orgs: mocks.orgs.filter((org) => orgTypes.includes(org.orgType)),
        total: 100,
      },
    };
  },
}));
vi.mock("~/utils/store/modal", () => ({
  DeleteType: { ORG: "ORG" },
  ModalType: {
    ADMIN_ORG: "ADMIN_ORG",
    ADMIN_DELETE_CONFIRMATION: "ADMIN_DELETE_CONFIRMATION",
  },
  openModal: mocks.open,
}));
vi.mock("@acme/ui/md-table", async (importOriginal) => {
  const actual = await importOriginal<typeof MDTableModule>();
  return {
    ...actual,
    MDTable: (props: Record<string, unknown>) => {
      mocks.props = props;
      return (
        <div>
          {props.filterComponent as ReactNode}
          <button
            onClick={() =>
              (props.setSearchTerm as (value: string) => void)?.("needle")
            }
          >
            Search
          </button>
          <button
            onClick={() =>
              (props.setSorting as (value: unknown) => void)?.([
                { id: "name", desc: true },
              ])
            }
          >
            Sort
          </button>
          <button
            onClick={() =>
              (props.setPagination as (value: unknown) => void)?.({
                pageIndex: 2,
                pageSize: 50,
              })
            }
          >
            Page
          </button>
          <button
            onClick={() =>
              (props.onRowClick as (value: unknown) => void)({
                original: { id: 40 },
              })
            }
          >
            Edit row
          </button>
        </div>
      );
    },
  };
});
vi.mock("../mobile-filter-sheet", () => ({ MobileFilterSheet: () => null }));
vi.mock("../status-filter", () => ({
  StatusFilter: ({
    setSelectedStatuses,
    setOnlyMine,
  }: {
    setSelectedStatuses: (value: string[]) => void;
    setOnlyMine: (value: boolean) => void;
  }) => (
    <button
      onClick={() => {
        setSelectedStatuses(["inactive"]);
        setOnlyMine(false);
      }}
    >
      Inactive all
    </button>
  ),
}));
vi.mock("../reset-filter", () => ({
  ResetFilter: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>Reset</button>
  ),
}));

beforeEach(() => {
  mocks.inputs = [];
  mocks.orgs = [];
  mocks.props = {};
  vi.clearAllMocks();
});
const lastQuery = (type: string) =>
  [...mocks.inputs]
    .reverse()
    .find((input) => JSON.stringify(input.orgTypes) === JSON.stringify([type]));

describe.each(OrgType)("%s table contract", (type) => {
  it("preserves initial query, column IDs and row action dispatch", () => {
    render(<OrgTable orgType={type} />);
    const expected: Record<string, unknown> = { orgTypes: [type] };
    if (type !== "nation")
      Object.assign(expected, {
        pageIndex: 0,
        pageSize: 10,
        statuses: ["active"],
        onlyMine: true,
        searchTerm: type === "ao" ? "" : undefined,
      });
    if (type !== "nation" && type !== "sector")
      expected.parentOrgIds = type === "ao" ? [] : undefined;
    if (["ao", "area", "territory", "sector"].includes(type))
      expected.sorting = [];
    expect(lastQuery(type)).toEqual(expected);
    const columns = mocks.props.columns as {
      id?: string;
      accessorKey?: string;
      meta?: { name: string };
    }[];
    const extra =
      type === "area"
        ? ["territoryName", "sectorName"]
        : type === "territory"
          ? ["parentOrgName"]
          : type === "region"
            ? ["area", "sector"]
            : type === "ao"
              ? ["parentOrgName"]
              : [];
    expect(columns.map((column) => column.id ?? column.accessorKey)).toEqual([
      "name",
      ...extra,
      ["sector", "territory", "area"].includes(type) ? "status" : "isActive",
      ...(["sector", "territory", "area", "region"].includes(type)
        ? ["aoCount"]
        : []),
      "lastAnnualReview",
      "created",
      "id",
    ]);
    expect(columns[0]?.meta?.name).toBe(
      type === "ao" ? "Name" : orgTypeDisplay[type].label,
    );
    if (type === "nation") {
      expect(mocks.props).not.toHaveProperty("totalCount");
      expect(mocks.props).not.toHaveProperty("pagination");
      expect(screen.queryByText("Reset")).toBeNull();
    }
    if (type === "region") expect(mocks.props).not.toHaveProperty("sorting");
    expect(mocks.props.paginationOptions).toEqual(
      type === "region"
        ? { pageSize: 20, pageSizeOptions: [10, 20, 50, 100] }
        : { pageSize: 20 },
    );
    fireEvent.click(screen.getByText("Edit row"));
    expect(mocks.open).toHaveBeenCalledWith("ADMIN_ORG", {
      orgType: type,
      id: 40,
    });
  });
});

describe("ancestor columns", () => {
  const columnsFor = (type: "area" | "territory") => {
    render(<OrgTable orgType={type} />);
    return mocks.props.columns as {
      id?: string;
      accessorKey?: string;
      enableSorting?: boolean;
    }[];
  };
  const find = (columns: ReturnType<typeof columnsFor>, key: string) =>
    columns.find((column) => (column.id ?? column.accessorKey) === key);

  it("enables the area table's resolved territory and sector server sort ids", () => {
    const columns = columnsFor("area");

    expect(find(columns, "territoryName")?.accessorKey).toBe("territory");
    expect(find(columns, "sectorName")?.accessorKey).toBe("sector");
    expect(find(columns, "territoryName")?.enableSorting).not.toBe(false);
    expect(find(columns, "sectorName")?.enableSorting).not.toBe(false);
  });

  it("sorts the territory table's sector column by its parent's name", () => {
    const columns = columnsFor("territory");

    expect(find(columns, "parentOrgName")).toBeDefined();
    expect(find(columns, "parentOrgName")?.enableSorting).not.toBe(false);
  });

  it("renders the area table's resolved territory and sector headers with sort buttons", () => {
    render(<OrgTable orgType="area" />);
    const table = capturedTable([]);
    const rendered = (id: string) => {
      const column = table.getColumn(id)!;
      return render(
        flexRender(column.columnDef.header, {
          table,
          column,
          header: {} as never,
        }),
      ).container;
    };

    for (const [id, label] of [
      ["territoryName", "Territory"],
      ["sectorName", "Sector"],
    ] as const) {
      const container = rendered(id);
      expect(container.textContent).toBe(label);
      expect(container.querySelector("button")).not.toBeNull();
    }
    expect(rendered("name").querySelector("button")).not.toBeNull();
  });

  it.each([
    {
      name: "an area with a missing parent",
      areaParentId: 999,
      territory: "",
      sector: "",
    },
    {
      name: "an area without a parent",
      areaParentId: null,
      territory: "",
      sector: "",
    },
    {
      name: "an area directly under a sector",
      areaParentId: 2,
      territory: "",
      sector: "Sector One",
    },
    {
      name: "an area under an inactive territory",
      areaParentId: 1,
      territory: "Inactive Territory",
      sector: "Sector One",
    },
  ])(
    "renders the resolved Territory and Sector text for $name",
    ({ areaParentId, territory, sector }) => {
      mocks.orgs = [
        { id: 2, parentId: null, orgType: "sector", name: "Sector One" },
        {
          id: 1,
          parentId: 2,
          orgType: "territory",
          name: "Inactive Territory",
          isActive: false,
        },
        { id: 3, parentId: areaParentId, orgType: "area", name: "Area" },
      ];
      render(<OrgTable orgType="area" />);
      const table = capturedTable(mocks.props.data as Org[]);
      const cellText = (id: string) => {
        const cell = table
          .getRowModel()
          .rows[0]!.getAllCells()
          .find((item) => item.column.id === id)!;
        return render(flexRender(cell.column.columnDef.cell, cell.getContext()))
          .container.textContent;
      };

      expect(cellText("territoryName")).toBe(territory);
      expect(cellText("sectorName")).toBe(sector);
    },
  );
});

it.each(["sector", "territory", "area", "region", "ao"] as const)(
  "preserves %s search/sorting while resetting filters and page",
  (type) => {
    render(<OrgTable orgType={type} />);
    fireEvent.click(screen.getByText("Search"));
    fireEvent.click(screen.getByText("Sort"));
    fireEvent.click(screen.getByText("Page"));
    expect(lastQuery(type)).toMatchObject({
      pageIndex: 2,
      pageSize: 50,
      searchTerm: "needle",
    });
    fireEvent.click(screen.getByText("Inactive all"));
    expect(lastQuery(type)).toMatchObject({
      statuses: ["inactive"],
      onlyMine: undefined,
    });
    fireEvent.click(screen.getByText("Reset"));
    expect(lastQuery(type)).toMatchObject({
      pageIndex: 0,
      pageSize: 50,
      statuses: ["active"],
      onlyMine: true,
      searchTerm: "needle",
    });
    if (type !== "region")
      expect(lastQuery(type)?.sorting).toEqual([{ id: "name", desc: true }]);
    else expect(lastQuery(type)).not.toHaveProperty("sorting");
  },
);

it("retains the independent AO Region-filter option query", () => {
  render(<OrgTable orgType="ao" />);
  expect(mocks.inputs).toContainEqual({ orgTypes: ["region"] });
});

type Org = RouterOutputs["org"]["all"]["orgs"][number];

it("keeps the Area row action bound to its row after ancestor sorting", async () => {
  render(<OrgTable orgType="area" />);
  const before = capturedTable([]);
  const column = before.getColumn("sectorName")!;
  const header = render(
    flexRender(column.columnDef.header, {
      table: before,
      column,
      header: {} as never,
    }),
  );
  fireEvent.click(header.getByRole("button", { name: "Sector" }));
  expect(lastQuery("area")?.sorting).toEqual([
    { id: "sectorName", desc: false },
  ]);
  header.unmount();
  const table = capturedTable([{ id: 40, isActive: true } as Org]);
  const cell = table
    .getRowModel()
    .rows[0]!.getAllCells()
    .find((item) => item.column.id === "id")!;
  render(flexRender(cell.column.columnDef.cell, cell.getContext()));
  fireEvent.keyDown(screen.getByRole("button", { name: "Open menu" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Deactivate" }));
  expect(mocks.open).toHaveBeenCalledWith("ADMIN_DELETE_CONFIRMATION", {
    id: 40,
    type: "ORG",
    orgType: "area",
  });
});

function capturedTable(data: Org[]) {
  return renderHook(() =>
    useTable({
      features: mdTableFeatures,
      data,
      columns: mocks.props.columns as ColumnDef<MdTableFeatures, Org>[],
      state: {
        sorting: (mocks.props.sorting as SortingState | undefined) ?? [],
      },
      onSortingChange: mocks.props.setSorting as OnChangeFn<SortingState>,
      renderFallbackValue: null,
    }),
  ).result.current;
}

it.each(["sectorName", "territoryName"])(
  "clicking the Area %s header sends ascending and descending server sorting",
  (id) => {
    render(<OrgTable orgType="area" />);
    for (const desc of [false, true]) {
      const table = capturedTable([]);
      const column = table.getColumn(id)!;
      const header = render(
        flexRender(column.columnDef.header, {
          table,
          column,
          header: {} as never,
        }),
      );
      fireEvent.click(
        header.getByRole("button", {
          name: id === "sectorName" ? "Sector" : "Territory",
        }),
      );
      expect(lastQuery("area")?.sorting).toEqual([{ id, desc }]);
      header.unmount();
    }
  },
);

it.each(["sector", "area"] as const)(
  "does not allow sorting the %s action column",
  (type) => {
    render(<OrgTable orgType={type} />);
    const table = capturedTable([{ id: 40 } as Org]);
    expect(table.getColumn("name")!.getCanSort()).toBe(true);
    expect(table.getColumn("id")!.getCanSort()).toBe(false);
    expect(table.getColumn("id")!.columnDef.enableSorting).toBe(false);
  },
);

it.each(["nation", "region", "ao"] as const)(
  "omits an explicit sorting override for the %s action column",
  (type) => {
    render(<OrgTable orgType={type} />);
    const table = capturedTable([{ id: 40 } as Org]);
    expect(table.getColumn("id")!.columnDef.enableSorting).toBeUndefined();
  },
);

it.each(["region", "area", null] as const)(
  "renders the AO Region cell only for a region parent (%s)",
  (parentOrgType) => {
    render(<OrgTable orgType="ao" />);
    const table = capturedTable([
      { id: 40, parentOrgType, parentOrgName: "Parent fixture" } as Org,
    ]);
    const cell = table
      .getRowModel()
      .rows[0]!.getAllCells()
      .find((item) => item.column.id === "parentOrgName")!;
    const view = render(
      flexRender(cell.column.columnDef.cell, cell.getContext()),
    );
    expect(view.container.textContent).toBe(
      parentOrgType === "region" ? "Parent fixture" : "",
    );
  },
);

it.each(["sector", "territory"] as const)(
  "caps Area %s display at 20 parent edges while preserving Region display",
  (ancestorType) => {
    const chain = Array.from({ length: ORG_TREE_MAX_DEPTH + 1 }, (_, i) => ({
      id: i + 1,
      parentId: i === ORG_TREE_MAX_DEPTH ? null : i + 2,
      orgType: i === ORG_TREE_MAX_DEPTH ? ancestorType : "nation",
      name: i === ORG_TREE_MAX_DEPTH ? "Boundary ancestor" : "Intermediate",
    }));
    mocks.orgs = [
      ...chain,
      { id: 100, parentId: 2, orgType: "area", name: "At limit" },
      { id: 101, parentId: 1, orgType: "area", name: "Beyond limit" },
      { id: 102, parentId: 1, orgType: "region", name: "Legacy Region" },
    ];
    const area = render(<OrgTable orgType="area" />);
    expect(mocks.props.data).toEqual([
      expect.objectContaining({ id: 100, [ancestorType]: "Boundary ancestor" }),
      expect.objectContaining({ id: 101, [ancestorType]: undefined }),
    ]);
    area.unmount();
    render(<OrgTable orgType="region" />);
    expect(mocks.props.data).toEqual([
      expect.objectContaining({
        id: 102,
        sector: ancestorType === "sector" ? "Boundary ancestor" : undefined,
      }),
    ]);
  },
);
