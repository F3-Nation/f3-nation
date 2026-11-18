import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UserMutate from "./user-mutate";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  crupdate: vi.fn<(input: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMutate user={user} />
    </QueryClientProvider>,
  );
}

describe("UserMutate navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
