import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  createTable,
  flexRender,
  getCoreRowModel,
} from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { RouterOutputs } from "~/orpc/types";
import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { OrgTable } from "./org-table";
import type * as MDTableModule from "@acme/ui/md-table";

const mocks = vi.hoisted(
  (): {
    inputs: Record<string, unknown>[];
    props: Record<string, unknown>;
    open: ReturnType<typeof vi.fn>;
  } => ({
    inputs: [] as Record<string, unknown>[],
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
    return { data: { orgs: [], total: 100 } };
  },
}));
vi.mock("~/utils/store/modal", () => ({
  DeleteType: { ORG: "ORG" },
  ModalType: { ADMIN_ORG: "ADMIN_ORG" },
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
    if (["ao", "area", "sector"].includes(type)) expected.sorting = [];
    expect(lastQuery(type)).toEqual(expected);
    const columns = mocks.props.columns as {
      id?: string;
      accessorKey?: string;
      meta?: { name: string };
    }[];
    const extra =
      type === "area"
        ? ["parentOrgName"]
        : type === "region"
          ? ["area", "sector"]
          : type === "ao"
            ? ["parentOrgName"]
            : [];
    expect(columns.map((column) => column.id ?? column.accessorKey)).toEqual([
      "name",
      ...extra,
      ["sector", "area"].includes(type) ? "status" : "isActive",
      ...(["sector", "area", "region"].includes(type) ? ["aoCount"] : []),
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

it.each(["sector", "area", "region", "ao"] as const)(
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
function capturedTable(data: Org[]) {
  return createTable({
    data,
    columns: mocks.props.columns as ColumnDef<Org>[],
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange: vi.fn(),
    renderFallbackValue: null,
  });
}

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
