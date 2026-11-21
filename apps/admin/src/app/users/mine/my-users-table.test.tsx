import { render, screen } from "@testing-library/react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestUser {
  id: number;
  status: "active" | "inactive";
  created: string;
  roles: { orgId: number; orgName: string; roleName: "editor" | "admin" }[];
  name: string;
  email?: string;
  phone?: string | null;
  piiVisible: boolean;
}

interface ByOrgsInput {
  orgIds: number[];
  includePii: boolean;
}

const mocks = vi.hoisted(() => ({
  sessionRoles: [] as { orgId: number; orgName: string; roleName: string }[],
  users: [] as unknown[],
  queryInputs: [] as unknown[],
}));

vi.mock("~/orpc/react", () => ({
  orpc: {
    user: {
      byOrgs: {
        queryOptions: (options: { input: ByOrgsInput; enabled: boolean }) =>
          options,
      },
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ input, enabled }: { input: ByOrgsInput; enabled: boolean }) => {
    if (!enabled) return { data: undefined };
    mocks.queryInputs.push(input);
    return { data: { users: mocks.users, totalCount: mocks.users.length } };
  },
}));

vi.mock("~/lib/auth/client", () => ({
  useAdminSession: () => ({ data: { id: 1, roles: mocks.sessionRoles } }),
}));

vi.mock("~/utils/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("~/utils/store/modal", () => ({
  DeleteType: { USER: "user" },
  ModalType: {
    ADMIN_USERS: "admin-users",
    ADMIN_MANAGE_ACCESS: "admin-manage-access",
    ADMIN_DELETE_CONFIRMATION: "admin-delete-confirmation",
  },
  openModal: vi.fn(),
}));

vi.mock("../org-filter", () => ({ OrgFilter: () => null }));
vi.mock("../../_components/reset-filter", () => ({ ResetFilter: () => null }));
vi.mock("../../_components/mobile-filter-sheet", () => ({
  MobileFilterSheet: () => null,
}));

// Renders each row's email and phone cells through the table's own column
// definitions, without the row model the real MDTable needs.
vi.mock("@acme/ui/md-table", () => ({
  MDTable: ({
    data,
    columns,
  }: {
    data: TestUser[] | undefined;
    columns: {
      accessorKey?: keyof TestUser;
      cell?: (context: {
        row: { original: TestUser };
        getValue: () => unknown;
      }) => ReactModule.ReactNode;
    }[];
  }) => (
    <div>
      {data?.map((user) => (
        <div key={user.id}>
          {columns
            .filter(
              ({ accessorKey }) =>
                accessorKey === "email" || accessorKey === "phone",
            )
            .map(({ accessorKey, cell }) => (
              <div key={accessorKey} data-testid={`${accessorKey}-${user.id}`}>
                {cell?.({
                  row: { original: user },
                  getValue: () => (accessorKey ? user[accessorKey] : undefined),
                })}
              </div>
            ))}
        </div>
      ))}
    </div>
  ),
  usePagination: () => ({
    pagination: { pageIndex: 0, pageSize: 20 },
    setPagination: vi.fn(),
  }),
}));

import { MyUsersTable } from "./my-users-table";

const makeUser = (overrides: Partial<TestUser>): TestUser => ({
  id: 1,
  status: "active",
  created: "2026-01-01T00:00:00.000Z",
  roles: [],
  name: "Test User",
  piiVisible: false,
  ...overrides,
});

describe("MyUsersTable", () => {
  beforeEach(() => {
    mocks.sessionRoles = [
      { orgId: 10, orgName: "Region Ten", roleName: "admin" },
      { orgId: 20, orgName: "Region Twenty", roleName: "editor" },
      { orgId: 30, orgName: "Region Thirty", roleName: "user" },
    ];
    mocks.users = [];
    mocks.queryInputs = [];
  });

  it("shows the email and phone of a user whose PII the API includes", () => {
    mocks.users = [
      makeUser({
        id: 7,
        email: "pax@example.com",
        phone: "555-0100",
        piiVisible: true,
      }),
    ];

    render(<MyUsersTable />);

    expect(screen.getByTestId("email-7").textContent).toBe("pax@example.com");
    expect(screen.getByTestId("phone-7").textContent).toBe("555-0100");
  });

  it("shows Hidden for the email and phone of a user whose PII the API withholds", () => {
    mocks.users = [makeUser({ id: 8, piiVisible: false })];

    render(<MyUsersTable />);

    expect(screen.getByTestId("email-8").textContent).toBe("Hidden");
    expect(screen.getByTestId("phone-8").textContent).toBe("Hidden");
  });

  it("asks for PII across the orgs the caller is an admin or editor of", () => {
    render(<MyUsersTable />);

    expect(mocks.queryInputs.at(-1)).toMatchObject({
      orgIds: [10, 20],
      includePii: true,
    });
  });

  it("explains why the table is empty to a caller with no admin or editor org", () => {
    mocks.sessionRoles = [
      { orgId: 30, orgName: "Region Thirty", roleName: "user" },
    ];

    render(<MyUsersTable />);

    expect(screen.getByText(/You need to be an admin or editor/)).toBeTruthy();
    expect(mocks.queryInputs).toEqual([]);
  });
});
