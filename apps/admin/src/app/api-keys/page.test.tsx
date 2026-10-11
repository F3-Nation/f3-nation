import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSession, AdminSessionRole } from "~/lib/auth/session";
import { createQueryClient } from "~/orpc/query-client";
import type * as ModalStore from "~/utils/store/modal";
import { ModalType } from "~/utils/store/modal";
import ApiKeysPage from "./page";

const mocks = vi.hoisted(() => ({
  session: null as AdminSession | null,
  status: "unauthenticated",
  list: vi.fn(),
  queryOptions: vi.fn(),
  openModal: vi.fn(),
}));

vi.mock("../admin-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("~/lib/auth/client", () => ({
  useAdminSession: () => ({
    data: mocks.session,
    status: mocks.status,
    update: vi.fn(),
  }),
}));

vi.mock("~/orpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  return {
    useQuery,
    useMutation,
    invalidateQueries: vi.fn(),
    orpc: {
      apiKey: {
        list: { queryOptions: mocks.queryOptions },
        revoke: { mutationOptions: () => ({}) },
        purge: { mutationOptions: () => ({}) },
      },
    },
  };
});

vi.mock("~/utils/store/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof ModalStore>()),
  openModal: mocks.openModal,
}));

vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const sessionFor = (
  roleName?: AdminSessionRole["roleName"],
  orgId = 2,
): AdminSession => ({
  sub: "42",
  id: 42,
  email: "api-key-test@example.invalid",
  roles: roleName
    ? [{ orgId, orgName: orgId === 1 ? "F3 Nation" : "Test region", roleName }]
    : [],
});

let queryClient: ReturnType<typeof createQueryClient>;
const page = () => (
  <QueryClientProvider client={queryClient}>
    <ApiKeysPage />
  </QueryClientProvider>
);

const expectNoKeyAccess = () => {
  expect(screen.queryByRole("button", { name: "New API Key" })).toBeNull();
  expect(screen.queryByText("Existing keys")).toBeNull();
  expect(mocks.queryOptions).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.openModal).not.toHaveBeenCalled();
};

describe("API Keys direct page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = null;
    mocks.status = "unauthenticated";
    mocks.list.mockResolvedValue({ apiKeys: [] });
    mocks.queryOptions.mockImplementation(() => ({
      queryKey: ["apiKey", "list"],
      queryFn: mocks.list,
    }));
    queryClient = createQueryClient();
    const defaults = queryClient.getDefaultOptions();
    queryClient.setDefaultOptions({
      ...defaults,
      queries: { ...defaults.queries, retry: false },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it.each([
    { label: "editor", session: sessionFor("editor") },
    { label: "ordinary user", session: sessionFor("user", 1) },
    { label: "session without roles", session: sessionFor() },
    { label: "unauthenticated visitor", session: null },
  ])("denies $label without requesting keys", ({ session }) => {
    mocks.session = session;
    mocks.status = session ? "authenticated" : "unauthenticated";
    render(page());

    expect(screen.getByText("Only admins can manage API keys.")).toBeTruthy();
    expectNoKeyAccess();
  });

  it.each([
    { label: "no cached session", session: null },
    { label: "cached admin", session: sessionFor("admin") },
  ])("waits for session loading with $label", ({ session }) => {
    mocks.session = session;
    mocks.status = "loading";
    render(page());

    expect(screen.getByRole("status").textContent).toBe("Loading session");
    expect(screen.queryByText("Only admins can manage API keys.")).toBeNull();
    expectNoKeyAccess();
  });

  it.each([2, 1])(
    "lets an admin of org %i list and create keys",
    async (orgId) => {
      mocks.session = sessionFor("admin", orgId);
      mocks.status = "authenticated";
      render(page());

      expect(await screen.findByText("No API keys yet.")).toBeTruthy();
      expect(mocks.list).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "New API Key" }));
      expect(mocks.openModal).toHaveBeenCalledTimes(1);
      expect(mocks.openModal).toHaveBeenCalledWith(ModalType.ADMIN_API_KEYS);
    },
  );

  it("uses refreshed roles before mounting key controls", async () => {
    mocks.session = sessionFor("admin");
    mocks.status = "loading";
    const { rerender } = render(page());
    expectNoKeyAccess();

    mocks.session = sessionFor("editor");
    mocks.status = "authenticated";
    rerender(page());
    expect(screen.getByText("Only admins can manage API keys.")).toBeTruthy();
    expectNoKeyAccess();

    mocks.session = sessionFor("admin");
    rerender(page());
    expect(await screen.findByText("No API keys yet.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "New API Key" })).toBeTruthy();
  });
});
