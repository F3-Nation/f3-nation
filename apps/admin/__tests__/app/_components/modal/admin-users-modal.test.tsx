import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminUsersModal from "~/app/_components/modal/admin-users-modal";

const mocks = vi.hoisted(() => ({
  byId: vi.fn<(input: unknown) => Promise<unknown>>(),
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
          mutationFn: () => Promise.resolve({}),
        }),
      },
    },
  },
}));
vi.mock("~/orpc/client", () => ({
  client: {
    org: {
      accessible: () => Promise.resolve({ orgs: [], total: 0 }),
      all: () => Promise.resolve({ orgs: [], total: 0 }),
    },
  },
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

describe("AdminUsersModal email field", () => {
  beforeEach(() => {
    mocks.byId.mockReset();
  });

  afterEach(() => {
    cleanup();
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
});
