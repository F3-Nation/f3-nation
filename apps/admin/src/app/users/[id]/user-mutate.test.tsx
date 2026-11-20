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
