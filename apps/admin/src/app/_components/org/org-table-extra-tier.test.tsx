import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgType } from "@acme/shared/app/enums";
import type * as OrgHierarchy from "@acme/shared/app/org-hierarchy";
import type * as OrgAdminConfigModule from "./org-admin-config";

interface TestOrg {
  id: number;
  parentId: number | null;
  name: string;
  orgType: string;
  isActive: boolean;
}

interface QueryInput {
  pageIndex?: number;
  parentOrgIds?: number[];
}

const mocks = vi.hoisted(() => ({
  hierarchyOrgs: [] as TestOrg[],
  queryInputs: [] as QueryInput[],
}));

vi.mock("~/orpc/client", () => ({ client: { org: { all: vi.fn() } } }));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({ data: mocks.hierarchyOrgs }),
}));
vi.mock("~/orpc/react", () => ({
  orpc: {
    org: { all: { queryOptions: ({ input }: { input: QueryInput }) => input } },
  },
  useQuery: (input: QueryInput) => {
    mocks.queryInputs.push(input);
    return { data: { orgs: [], total: 0 } };
  },
}));

// A tier the OrgType enum does not have, added through configuration only: a
// display entry, and one table config. Nothing in the hook or the table knows it.
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
vi.mock("./org-admin-config", async (importOriginal) => {
  const actual = await importOriginal<typeof OrgAdminConfigModule>();
  return {
    ...actual,
    orgAdminConfig: {
      ...actual.orgAdminConfig,
      zone: {
        add: false,
        serverPagination: true,
        serverSorting: false,
        filters: "hierarchy",
        hierarchyFilter: {
          tiers: ["sector", "zone", "territory"],
          match: { tiers: ["territory"], includeInactive: true },
        },
        ancestorTypes: ["sector", "zone", "territory", "nation"],
        columns: [],
        statusId: "status",
        aoCount: false,
      },
    },
  };
});

vi.mock("@acme/ui/md-table", () => ({
  MDTable: ({ filterComponent }: { filterComponent: React.ReactNode }) => (
    <div>{filterComponent}</div>
  ),
  usePagination: () => ({
    pagination: { pageIndex: 0, pageSize: 20 },
    setPagination: vi.fn(),
  }),
}));
vi.mock("./org-picker-filter", () => ({
  OrgPickerFilter: ({
    orgType,
    orgs,
    onSelect,
  }: {
    orgType: string;
    orgs: TestOrg[] | undefined;
    onSelect: (org: TestOrg) => void;
  }) => (
    <div>
      {orgs?.map((org) => (
        <button
          key={org.id}
          data-testid={`${orgType}-${org.id}`}
          onClick={() => onSelect(org)}
        >
          {org.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../mobile-filter-sheet", () => ({
  MobileFilterSheet: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="mobile-sheet">{children}</section>
  ),
}));
vi.mock("../reset-filter", () => ({ ResetFilter: () => null }));
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

const org = (
  id: number,
  parentId: number | null,
  orgType: string,
  isActive = true,
): TestOrg => ({ id, parentId, name: `${orgType} ${id}`, orgType, isActive });

const zone = "zone" as OrgType;

const latestResultQuery = () =>
  [...mocks.queryInputs]
    .reverse()
    .find((input) => input.pageIndex !== undefined);

describe("OrgTable with a tier added by configuration only", () => {
  beforeEach(() => {
    mocks.queryInputs = [];
    mocks.hierarchyOrgs = [
      org(1, null, "nation"),
      org(2, 1, "sector"),
      org(3, 2, "zone"),
      org(4, 3, "territory"),
      org(5, 3, "territory", false),
    ];
  });

  it("renders a picker for every tier in both the desktop strip and the mobile sheet", () => {
    render(<OrgTable orgType={zone} />);

    for (const testId of ["sector-2", "zone-3", "territory-4"]) {
      expect(screen.getAllByTestId(testId)).toHaveLength(2);
    }
    expect(screen.queryByTestId("territory-5")).toBeNull();
    const sheet = screen.getByTestId("mobile-sheet");
    expect(sheet.textContent).toContain("Sector");
    expect(sheet.textContent).toContain("Zone");
    expect(sheet.textContent).toContain("Territory");
  });

  it("sends the filter that tier's configuration declares", () => {
    render(<OrgTable orgType={zone} />);
    expect(latestResultQuery()?.parentOrgIds).toBeUndefined();

    fireEvent.click(screen.getAllByTestId("sector-2")[0]!);

    expect(latestResultQuery()?.parentOrgIds).toEqual([2, 3, 4, 5]);
  });
});
