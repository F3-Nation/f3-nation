import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminUsersModal from "~/app/_components/modal/admin-users-modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  crupdate: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("~/lib/auth/client", () => ({
  useAdminSession: () => ({
    data: {
      id: 1,
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    },
    update: vi.fn(),
  }),
}));
vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
      crupdate: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.crupdate,
        }),
      },
    },
  },
}));
vi.mock("~/orpc/client", () => ({
  client: {
    org: {
      accessible: () =>
        Promise.resolve({
          orgs: [{ id: 10, name: "Source", roles: ["admin"] }],
          total: 1,
        }),
      all: () =>
        Promise.resolve({
          orgs: [
            { id: 10, name: "Source" },
            { id: 20, name: "Destination" },
          ],
          total: 2,
        }),
    },
  },
}));

// The virtualized picker needs browser layout; exercise its value/onSelect
// boundary here while retaining the real form, confirmation and mutation.
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
      aria-label="Home region picker"
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

const withProviders = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

// A user with no roles and no home region, as user.byId returns them.
const roleLessUser = {
  id: 42,
  f3Name: "NoRoles",
  firstName: null,
  lastName: null,
  homeRegionId: null,
  homeRegion: null,
  status: "active",
  roles: [],
  positions: [],
};

describe("AdminUsersModal", () => {
  beforeEach(() => {
    mocks.byId.mockReset();
    mocks.crupdate.mockReset().mockResolvedValue({ id: 42, roles: [] });
  });

  afterEach(() => {
    cleanup();
  });

  // React deduplicates this warning, so check it before other user loads.
  it("keeps the disabled ID controlled while user details load", async () => {
    let resolveUser!: (value: unknown) => void;
    const byId = new Promise((resolve) => {
      resolveUser = resolve;
    });
    mocks.byId.mockReturnValue(byId);
    const consoleError = vi.spyOn(console, "error");
    const queryClient = new QueryClient();

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <AdminUsersModal data={{ id: 42 }} />
        </QueryClientProvider>,
      );
      const id = screen.getByPlaceholderText<HTMLInputElement>("ID");
      expect(id.disabled).toBe(true);
      expect(id.value).toBe("");

      await act(async () => {
        resolveUser({ user: roleLessUser, includePii: false });
        await byId;
      });
      await waitFor(() => expect(id.value).toBe("42"));
      expect(id.disabled).toBe(true);
      expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
        /uncontrolled input to be controlled|controlled input to be uncontrolled/,
      );
    } finally {
      cleanup();
      queryClient.clear();
      consoleError.mockRestore();
    }
  });

  it("shows the email of a user with no roles when byId grants PII access", async () => {
    mocks.byId.mockResolvedValue({
      user: { ...roleLessUser, email: "no-roles@example.com", phone: null },
      includePii: true,
    });

    render(withProviders(<AdminUsersModal data={{ id: 42 }} />));

    // Before byId resolves the modal shows an empty Email field (as for a new
    // user), so wait for the loaded value rather than the field itself.
    const email = await screen.findByDisplayValue<HTMLInputElement>(
      "no-roles@example.com",
    );
    expect(email.placeholder).toBe("Email");
  });

  it("hides the email field when byId withholds PII", async () => {
    mocks.byId.mockResolvedValue({ user: roleLessUser, includePii: false });

    render(withProviders(<AdminUsersModal data={{ id: 42 }} />));

    await screen.findByDisplayValue("NoRoles");
    expect(screen.queryByPlaceholderText("Email")).toBeNull();
  });
  const loadMember = async () => {
    mocks.byId.mockResolvedValue({
      user: { ...roleLessUser, homeRegionId: 10, email: "member@example.com" },
      includePii: true,
    });
    render(withProviders(<AdminUsersModal data={{ id: 42 }} />));
    await screen.findByDisplayValue("member@example.com");
    await screen.findByRole("option", { name: "Destination" });
  };

  it("confirms the named destination, cancels without saving, then saves once on confirmation", async () => {
    await loadMember();
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const confirmation = await screen.findByRole("alertdialog");
    expect(confirmation.textContent).toContain("Destination");
    expect(confirmation.textContent).toContain("may lose edit access");
    expect(mocks.crupdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.crupdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(mocks.crupdate.mock.calls[0]?.[0]).toMatchObject({
      id: 42,
      homeRegionId: 20,
    });
  });

  it("saves an unchanged home region without a confirmation", async () => {
    await loadMember();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("creates a user without a correction confirmation", async () => {
    render(withProviders(<AdminUsersModal data={{}} />));
    fireEvent.change(screen.getByPlaceholderText("F3 Name"), {
      target: { value: "NewMember" },
    });
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "new@example.com" },
    });
    await screen.findByRole("option", { name: "Destination" });
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.crupdate.mock.calls[0]?.[0]).toMatchObject({
      homeRegionId: 20,
      email: "new@example.com",
    });
  });
});
