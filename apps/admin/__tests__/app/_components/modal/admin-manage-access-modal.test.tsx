import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@acme/ui/toast";

import AdminManageAccessModal from "~/app/_components/modal/admin-manage-access-modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  crupdate: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("~/utils/store/modal", () => ({ closeModal: vi.fn() }));
vi.mock("~/utils/hooks/use-role-grant-orgs", () => ({
  useRoleGrantOrgs: () => ({
    orgs: [
      { id: 8, name: "Boone", orgType: "region", roles: ["admin"] },
      { id: 9, name: "Watauga", orgType: "region", roles: ["admin"] },
    ],
    isLoading: false,
  }),
}));

// Keep real React Query; replace only the API boundary.
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: vi.fn(),
  orpc: {
    user: {
      byId: {
        queryOptions: ({
          input,
          enabled,
        }: {
          input: unknown;
          enabled?: boolean;
        }) => ({
          queryKey: ["byId", input],
          queryFn: () => mocks.byId(input),
          enabled,
        }),
      },
      byEmail: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ["byEmail", input],
          queryFn: () => Promise.resolve({ user: null }),
          enabled: false,
        }),
      },
      crupdate: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: (input: unknown) => mocks.crupdate(input),
        }),
      },
    },
  },
}));

// Native stand-ins for the pickers, which need layout jsdom doesn't have.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    value,
    options,
    onSelect,
  }: {
    value?: string;
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select
      aria-label="Organization"
      value={value ?? ""}
      onChange={(event) => onSelect(event.target.value)}
    >
      <option value="">None</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@acme/ui/multi-select", () => ({
  MultiSelect: ({
    options,
    defaultValue,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    defaultValue: string[];
    onValueChange: (value: string[]) => void;
  }) => (
    <fieldset aria-label="Roles">
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={defaultValue.includes(option.value)}
            onChange={(event) =>
              onValueChange(
                event.target.checked
                  ? [...defaultValue, option.value]
                  : defaultValue.filter((v) => v !== option.value),
              )
            }
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  ),
}));

const member = {
  id: 42,
  email: "member@example.com",
  firstName: "Test",
  lastName: "Member",
  f3Name: "Member",
  phone: null,
  roles: [
    { orgId: 8, orgName: "Boone", roleName: "admin" },
    { orgId: 8, orgName: "Boone", roleName: "password_manager" },
    // Not among the orgs this admin can manage: shown read-only.
    { orgId: 1, orgName: "F3 Nation", roleName: "admin" },
  ],
};

function renderModal() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AdminManageAccessModal data={{ userId: 42 }} />
    </QueryClientProvider>,
  );
}

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Manage Access" }));

describe("AdminManageAccessModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.byId.mockResolvedValue({ user: member });
    mocks.crupdate.mockResolvedValue({ id: 42, roles: [] });
  });

  afterEach(cleanup);

  it("resubmits every role, including read-only ones, when nothing changes", async () => {
    renderModal();
    await screen.findByText("F3 Nation");

    submit();

    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(
      (mocks.crupdate.mock.calls[0]?.[0] as { roles: unknown }).roles,
    ).toEqual([
      { orgId: 8, roleName: "admin" },
      { orgId: 8, roleName: "password_manager" },
      { orgId: 1, roleName: "admin" },
    ]);
  });

  it("refuses to save an added organization with no role", async () => {
    renderModal();
    await screen.findByText("F3 Nation");

    fireEvent.click(screen.getByRole("button", { name: /Add organization/ }));
    const pickers = screen.getAllByLabelText("Organization");
    fireEvent.change(pickers[pickers.length - 1]!, { target: { value: "9" } });
    submit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Choose at least one role for each organization you added",
      ),
    );
    expect(mocks.crupdate).not.toHaveBeenCalled();

    const roleGroups = screen.getAllByRole("group", { name: "Roles" });
    fireEvent.click(
      within(roleGroups[roleGroups.length - 1]!).getByLabelText(
        "Password Reader",
      ),
    );
    submit();

    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(
      (mocks.crupdate.mock.calls[0]?.[0] as { roles: unknown }).roles,
    ).toEqual([
      { orgId: 8, roleName: "admin" },
      { orgId: 8, roleName: "password_manager" },
      { orgId: 1, roleName: "admin" },
      { orgId: 9, roleName: "password_reader" },
    ]);
  });
});
