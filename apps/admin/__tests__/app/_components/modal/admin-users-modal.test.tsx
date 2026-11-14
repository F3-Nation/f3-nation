import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@acme/ui/toast";
import type * as comboboxModule from "@acme/ui/virtualized-combobox";

import AdminUsersModal from "~/app/_components/modal/admin-users-modal";
import { createQueryClient } from "~/orpc/query-client";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
  orgAll: vi.fn(),
  realPicker: false,
  refresh: vi.fn(),
  invalidateQueries: vi.fn(),
  crupdate: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
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
  invalidateQueries: mocks.invalidateQueries,
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
          orgs: [
            { id: 10, name: "Source", roles: ["admin"] },
            { id: 30, name: "Competing region", roles: ["admin"] },
          ],
          total: 2,
        }),
      all: mocks.orgAll,
    },
  },
}));

// Most tests use a native select because the virtualized list needs layout.
// Popup-dependent cases enable the real picker and stub ResizeObserver.
vi.mock("@acme/ui/virtualized-combobox", async (importOriginal) => {
  const actual = await importOriginal<typeof comboboxModule>();
  return {
    VirtualizedCombobox: (
      props: ComponentProps<typeof actual.VirtualizedCombobox>,
    ) =>
      mocks.realPicker ? (
        <actual.VirtualizedCombobox {...props} />
      ) : (
        <select
          disabled={props.disabled}
          aria-label="Home region picker"
          value={props.value ?? ""}
          onChange={(event) => props.onSelect?.(event.target.value)}
        >
          <option value="">None</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ),
  };
});

const withProviders = (ui: ReactNode, queryClient = createQueryClient()) => {
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
};

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
    mocks.realPicker = false;
    mocks.refresh.mockClear();
    mocks.invalidateQueries.mockClear();
    vi.mocked(toast.error).mockClear();
    mocks.byId.mockReset();
    mocks.orgAll.mockReset().mockResolvedValue({
      orgs: [
        { id: 10, name: "Source" },
        { id: 20, name: "Destination" },
        { id: 30, name: "Competing region" },
      ],
      total: 3,
    });
    mocks.crupdate.mockReset().mockResolvedValue({ id: 42, roles: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // React deduplicates this warning, so check it before other user loads.
  it("keeps the disabled ID controlled while user details load", async () => {
    let resolveUser!: (value: unknown) => void;
    const byId = new Promise((resolve) => {
      resolveUser = resolve;
    });
    mocks.byId.mockReturnValue(byId);
    const consoleError = vi.spyOn(console, "error");
    const queryClient = createQueryClient();

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
    const queryClient = createQueryClient();
    render(withProviders(<AdminUsersModal data={{ id: 42 }} />, queryClient));
    await screen.findByDisplayValue("member@example.com");
    await screen.findByRole("option", { name: "Destination" });
    return queryClient;
  };

  it("requests eligible destinations and keeps a filtered-out current region visible", async () => {
    mocks.orgAll.mockResolvedValue({
      orgs: [{ id: 20, name: "Destination" }],
      total: 1,
    });
    mocks.byId.mockResolvedValue({
      user: {
        ...roleLessUser,
        homeRegionId: 10,
        homeRegion: {
          homeRegionId: 10,
          homeRegionName: "Current retired region",
        },
        email: "member@example.com",
      },
      includePii: true,
    });
    render(withProviders(<AdminUsersModal data={{ id: 42 }} />));
    await screen.findByDisplayValue("member@example.com");
    await screen.findByRole("option", { name: "Current retired region" });
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").value,
    ).toBe("10");
    expect(mocks.orgAll).toHaveBeenCalledWith(
      expect.objectContaining({
        orgTypes: ["region"],
        activeAncestorsOnly: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(mocks.crupdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, homeRegionId: 10 }),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each(["regions", "member"])(
    "closes the real open picker during %s refetch and preserves its value",
    async (refreshTarget) => {
      mocks.realPicker = true;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        },
      );
      mocks.byId.mockResolvedValue({
        user: {
          ...roleLessUser,
          homeRegionId: 10,
          email: "member@example.com",
        },
        includePii: true,
      });
      const queryClient = createQueryClient();
      render(withProviders(<AdminUsersModal data={{ id: 42 }} />, queryClient));
      await screen.findByDisplayValue("member@example.com");
      const trigger = (await screen.findByText("Source")).closest("button")!;
      fireEvent.click(trigger);
      await screen.findByRole("button", { name: "Clear" });
      let finish!: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        finish = resolve;
      });
      if (refreshTarget === "regions")
        mocks.orgAll.mockReturnValueOnce(pending);
      else mocks.byId.mockReturnValueOnce(pending);
      await act(async () => {
        void queryClient.invalidateQueries({
          queryKey: refreshTarget === "regions" ? [["org", "all"]] : ["byId"],
        });
      });
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Clear" })).toBeNull(),
      );
      expect(screen.getByText("Source").closest("button")!.disabled).toBe(true);
      await act(async () => {
        finish(
          refreshTarget === "regions"
            ? { orgs: [{ id: 10, name: "Source" }], total: 1 }
            : {
                user: {
                  ...roleLessUser,
                  homeRegionId: 10,
                  email: "member@example.com",
                },
                includePii: true,
              },
        );
      });
      await waitFor(() =>
        expect(screen.getByText("Source").closest("button")!.disabled).toBe(
          false,
        ),
      );
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() =>
        expect(mocks.crupdate).toHaveBeenCalledWith(
          expect.objectContaining({ homeRegionId: 10 }),
          expect.anything(),
        ),
      );
    },
  );

  it("blocks the picker and saving until the first region load succeeds", async () => {
    let finish!: (value: unknown) => void;
    mocks.orgAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.byId.mockResolvedValue({
      user: { ...roleLessUser, homeRegionId: 10, email: "member@example.com" },
      includePii: true,
    });
    render(withProviders(<AdminUsersModal data={{ id: 42 }} />));
    await screen.findByDisplayValue("member@example.com");
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
        .disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.submit(
        screen.getByRole("button", { name: "Save Changes" }).closest("form")!,
      );
    });
    expect(mocks.crupdate).not.toHaveBeenCalled();
    await act(async () => {
      finish({ orgs: [{ id: 10, name: "Source" }], total: 1 });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(false),
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").disabled,
    ).toBe(false);
  });

  it("blocks confirmation during a region refresh and rejects a removed destination", async () => {
    const queryClient = await loadMember();
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Confirm change" });
    let finish!: (value: unknown) => void;
    mocks.orgAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: [["org", "all"]] });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Confirm change",
        }).disabled,
      ).toBe(true),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    });
    expect(mocks.crupdate).not.toHaveBeenCalled();
    await act(async () => {
      finish({ orgs: [{ id: 10, name: "Source" }], total: 1 });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Confirm change",
        }).disabled,
      ).toBe(false),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    });
    expect(toast.error).toHaveBeenCalledWith(
      "The selected home region is no longer available. Choose another region.",
    );
    expect(mocks.crupdate).not.toHaveBeenCalled();
  });

  it("reports a failed region refresh and disables its picker", async () => {
    const queryClient = await loadMember();
    mocks.orgAll.mockRejectedValue(new Error("Region lookup failed"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [["org", "all"]] });
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to load home regions",
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").disabled,
    ).toBe(true);
    expect(screen.getByRole("heading", { name: "Edit User" })).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(mocks.crupdate).not.toHaveBeenCalled();
  });

  it("rejects a destination removed from the region list before saving", async () => {
    const queryClient = await loadMember();
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    mocks.orgAll.mockResolvedValue({
      orgs: [{ id: 10, name: "Source" }],
      total: 1,
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [["org", "all"]] });
    });
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Destination" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The selected home region is no longer available. Choose another region.",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.crupdate).not.toHaveBeenCalled();
  });

  it("keeps a missing member hidden through pending and failed refreshes until data recovers", async () => {
    const queryClient = await loadMember();
    mocks.byId.mockResolvedValue({ user: null, includePii: false });
    mocks.crupdate.mockRejectedValueOnce(new ORPCError("CONFLICT"));
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This member no longer exists",
    );
    expect(screen.getByRole("heading", { name: "Edit User" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
    let rejectRefresh!: (error: Error) => void;
    mocks.byId.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["byId"] });
    });
    await waitFor(() =>
      expect(queryClient.isFetching({ queryKey: ["byId"] })).toBe(1),
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(
      screen.getByText("This member no longer exists. Close the form."),
    ).toBeTruthy();
    await act(async () => {
      rejectRefresh(new Error("Unavailable"));
    });
    await screen.findByText(
      "Unable to load this member. Close and reopen the form to try again.",
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(
      screen.getByText("This member no longer exists. Close the form."),
    ).toBeTruthy();
    mocks.byId.mockResolvedValue({
      user: {
        ...roleLessUser,
        f3Name: "Recovered",
        homeRegionId: 30,
        email: "member@example.com",
      },
      includePii: true,
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["byId"] });
    });
    await screen.findByDisplayValue("Recovered");
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").value,
    ).toBe("30");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(false),
    );
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.crupdate).toHaveBeenCalledTimes(2));
    expect(mocks.crupdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 42,
        f3Name: "Recovered",
        homeRegionId: 30,
      }),
      expect.anything(),
    );
  });

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
  it.each([
    [
      new ORPCError("UNAUTHORIZED"),
      "You are not authorized to update this user",
    ],
    [
      new ORPCError("BAD_REQUEST", {
        message: "Home region is no longer active",
      }),
      "Home region is no longer active",
    ],
    [new Error("Internal details"), "Failed to update user"],
  ])(
    "reports rejected corrections without reloading or retrying: %s",
    async (error, message) => {
      await loadMember();
      mocks.crupdate.mockRejectedValueOnce(error);
      fireEvent.change(screen.getByLabelText("Home region picker"), {
        target: { value: "20" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Confirm change" }),
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(screen.getByDisplayValue("member@example.com")).toBeTruthy();
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", {
            name: "Save Changes",
          }).disabled,
        ).toBe(false),
      );
      expect(mocks.crupdate).toHaveBeenCalledTimes(1);
      expect(mocks.byId).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    },
  );

  it("reloads the member after a conflict before allowing another correction", async () => {
    await loadMember();
    mocks.byId.mockResolvedValue({
      user: { ...roleLessUser, homeRegionId: 30, email: "member@example.com" },
      includePii: true,
    });
    mocks.crupdate.mockRejectedValueOnce(
      new ORPCError("CONFLICT", { message: "Home region changed" }),
    );
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() => expect(mocks.byId).toHaveBeenCalledTimes(2));
    expect(toast.error).toHaveBeenCalledWith(
      "This profile or its home region changed. Reloading the latest values replaces your unsaved edits.",
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>("Home region picker").value,
      ).toBe("30"),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      "Unable to reload this member. Close and reopen the form before trying again.",
    );
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
  });

  it("replaces unsaved edits and refreshes region choices after a hierarchy-only conflict", async () => {
    await loadMember();
    mocks.orgAll.mockResolvedValue({
      orgs: [
        { id: 10, name: "Source" },
        { id: 40, name: "New destination" },
      ],
      total: 2,
    });
    mocks.crupdate.mockRejectedValueOnce(
      new ORPCError("CONFLICT", {
        message: "The home region hierarchy changed",
      }),
    );
    fireEvent.change(screen.getByDisplayValue("NoRoles"), {
      target: { value: "Unsaved name" },
    });
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() => expect(mocks.byId).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByDisplayValue("NoRoles")).toBeTruthy(),
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").value,
    ).toBe("10");
    expect(
      screen.getByRole("option", { name: "New destination" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Destination" })).toBeNull();
    expect(toast.error).not.toHaveBeenCalledWith(
      "Unable to reload home regions. Close and reopen the form before trying again.",
    );
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
  });

  it("refreshes destination choices and blocks resubmission when their conflict reload fails", async () => {
    await loadMember();
    const previousCalls = mocks.orgAll.mock.calls.length;
    mocks.orgAll.mockRejectedValue(new Error("Unavailable"));
    mocks.crupdate.mockRejectedValueOnce(
      new ORPCError("CONFLICT", {
        message: "The home region hierarchy changed",
      }),
    );
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() =>
      expect(mocks.orgAll.mock.calls.length).toBeGreaterThan(previousCalls),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Unable to reload home regions. Close and reopen the form before trying again.",
      ),
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
        .disabled,
    ).toBe(true);
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
  });

  it("blocks resubmission if reloading after a conflict fails", async () => {
    await loadMember();
    mocks.byId.mockRejectedValue(new Error("Unavailable"));
    mocks.crupdate.mockRejectedValueOnce(new ORPCError("CONFLICT"));
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() => expect(mocks.byId).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Unable to reload this member. Close and reopen the form before trying again.",
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to load this member",
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.queryByRole("button", { name: "Confirm change" })).toBeNull();
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
  });

  it("cannot submit another save while the confirmed mutation is pending", async () => {
    await loadMember();
    let finish!: (value: unknown) => void;
    mocks.crupdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm change" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" })
          .disabled,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.queryByRole("button", { name: "Confirm change" })).toBeNull();
    expect(mocks.crupdate).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 42, roles: [] }));
  });
  it("preserves confirmation after an unchanged background refresh", async () => {
    const queryClient = await loadMember();
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Confirm change" });
    const response = queryClient.getQueryData([
      "byId",
      { id: 42, includePii: true },
    ]);
    mocks.byId.mockImplementation(async () => structuredClone(response));
    const previous = queryClient.getQueryState([
      "byId",
      { id: 42, includePii: true },
    ])?.dataUpdatedAt;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["byId"] });
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["byId", { id: 42, includePii: true }])
          ?.dataUpdatedAt,
      ).not.toBe(previous),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() =>
      expect(mocks.crupdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, homeRegionId: 20 }),
        expect.anything(),
      ),
    );
  });

  it("blocks confirmation during a reload and discards a superseded confirmation", async () => {
    const queryClient = await loadMember();
    fireEvent.change(screen.getByLabelText("Home region picker"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Confirm change" });
    let finish!: (value: unknown) => void;
    mocks.byId.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["byId"] });
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Confirm change",
        }).disabled,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    expect(mocks.crupdate).not.toHaveBeenCalled();
    await act(async () =>
      finish({
        user: {
          ...roleLessUser,
          homeRegionId: 30,
          email: "member@example.com",
        },
        includePii: true,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Confirm change" }),
      ).toBeNull(),
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Home region picker").value,
    ).toBe("30");
  });
});
