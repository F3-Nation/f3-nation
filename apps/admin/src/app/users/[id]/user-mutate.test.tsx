import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UserMutate from "./user-mutate";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  crupdate: vi.fn<(input: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  isNationAdmin: true,
  orgsFailed: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@acme/ui/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({ data: [] }),
}));
vi.mock("~/utils/hooks/use-role-grant-orgs", () => ({
  useRoleGrantOrgs: () => ({
    orgs: [{ id: 8, name: "Boone", orgType: "region", roles: ["admin"] }],
    isLoading: false,
    isError: mocks.orgsFailed,
  }),
}));
// Native stand-ins for the role editor's pickers, which need layout.
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
vi.mock("~/orpc/client", () => ({ client: {} }));
vi.mock("~/utils/hooks/use-auth", () => ({
  useAuth: () => ({ isNationAdmin: mocks.isNationAdmin }),
}));

// Keep real React Query; replace only the API boundary.
vi.mock("~/orpc/react", async () => ({
  ...(await import("@tanstack/react-query")),
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: vi.fn(),
  orpc: {
    user: {
      crupdate: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: (input: unknown) => mocks.crupdate(input),
        }),
      },
    },
  },
}));

const user = {
  id: 7,
  f3Name: "Hammer",
  firstName: "Test",
  lastName: "User",
  email: "hammer@example.com",
  roles: [],
} as unknown as Parameters<typeof UserMutate>[0]["user"];

function renderForm(formUser = user) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMutate user={formUser} />
    </QueryClientProvider>,
  );
}

describe("UserMutate navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNationAdmin = true;
    mocks.orgsFailed = false;
  });

  afterEach(cleanup);

  // The admin app is served from its own origin, so the users list is
  // `/users`; `/admin/users` would 404.
  it("returns to the users list after a successful save", async () => {
    mocks.crupdate.mockResolvedValue({});
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith("/users");
    expect(mocks.crupdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, email: "hammer@example.com" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Successfully upserted user",
    );
  });

  it("sends back every role the user holds when saving", async () => {
    mocks.crupdate.mockResolvedValue({});
    renderForm({
      ...user,
      roles: [
        { orgId: 8, orgName: "Boone", roleName: "admin" },
        { orgId: 8, orgName: "Boone", roleName: "password_manager" },
        { orgId: 1, orgName: "F3 Nation", roleName: "admin" },
      ],
    } as unknown as Parameters<typeof UserMutate>[0]["user"]);

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await vi.waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(
      (mocks.crupdate.mock.calls[0]?.[0] as { roles: unknown }).roles,
    ).toEqual([
      { orgId: 8, roleName: "admin" },
      { orgId: 8, roleName: "password_manager" },
      { orgId: 1, roleName: "admin" },
    ]);
  });

  it("refuses to save a role with no organization chosen", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /Add organization/ }));
    fireEvent.click(screen.getByLabelText("Editor"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    return vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Please select an organization for all roles before saving",
      );
      expect(mocks.crupdate).not.toHaveBeenCalled();
    });
  });

  it("refuses to save an added organization with no role", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /Add organization/ }));
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    return vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Choose at least one role for each organization you added",
      );
      expect(mocks.crupdate).not.toHaveBeenCalled();
    });
  });

  it("says when the organizations can't be loaded and blocks adding one", () => {
    mocks.orgsFailed = true;
    renderForm();

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load the organizations you manage",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /Add organization/,
      }).disabled,
    ).toBe(true);
  });

  it("stays on the form when the save fails", async () => {
    mocks.crupdate.mockRejectedValue(new Error("boom"));
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Failed to upsert user"),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("returns to the users list on Cancel without saving", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/users");
    expect(mocks.crupdate).not.toHaveBeenCalled();
  });
});

describe("UserMutate email field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("locks the email and links to the change request form for a non-nation admin", () => {
    mocks.isNationAdmin = false;
    renderForm();

    expect(
      screen.getByPlaceholderText<HTMLInputElement>("Email").disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: "Request a change" })
        .getAttribute("href"),
    ).toBe("https://forms.gle/XYcE4bwh55Qzvj5T6");
  });

  it("lets a nation admin edit the email", () => {
    mocks.isNationAdmin = true;
    renderForm();

    expect(
      screen.getByPlaceholderText<HTMLInputElement>("Email").disabled,
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Request a change" })).toBeNull();
  });
});
