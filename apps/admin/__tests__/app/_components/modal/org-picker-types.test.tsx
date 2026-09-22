import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminManageAccessModal from "~/app/_components/modal/admin-manage-access-modal";
import AdminUsersModal from "~/app/_components/modal/admin-users-modal";
import { OrgFilter as EventTypesOrgFilter } from "~/app/event-types/org-filter";
import { OrgFilter as UsersOrgFilter } from "~/app/users/org-filter";

const mocks = vi.hoisted(() => ({
  accessible: vi.fn<(input: unknown) => Promise<unknown>>(),
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("~/lib/auth/client", () => ({
  useAdminSession: () => ({ data: { id: 1, roles: [] }, update: vi.fn() }),
}));
vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Keep real React Query; replace only the API boundary and record org queries.
vi.mock("~/orpc/react", async () => {
  const queryOptions =
    (name: string, run: (input: unknown) => Promise<unknown>) =>
    ({ input, enabled }: { input: unknown; enabled?: boolean }) => ({
      queryKey: [name, input],
      queryFn: () => run(input),
      enabled,
    });
  const empty = () => Promise.resolve({ user: undefined });
  return {
    ...(await import("@tanstack/react-query")),
    ORPCError: (await import("@orpc/client")).ORPCError,
    invalidateQueries: vi.fn(),
    orpc: {
      org: {
        accessible: {
          queryOptions: queryOptions("accessible", mocks.accessible),
        },
        all: { queryOptions: queryOptions("all", mocks.all) },
      },
      user: {
        byId: { queryOptions: queryOptions("byId", empty) },
        byEmail: { queryOptions: queryOptions("byEmail", empty) },
        crupdate: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: () => Promise.resolve({}),
          }),
        },
      },
    },
  };
});

const withProviders = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const orgTypesRequested = (mock: typeof mocks.all) =>
  mock.mock.calls.map(([input]) => (input as { orgTypes?: string[] }).orgTypes);

describe("organization type pickers include every tier above AO", () => {
  beforeEach(() => {
    mocks.accessible.mockResolvedValue({ orgs: [], total: 0 });
    mocks.all.mockResolvedValue({ orgs: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const aboveAo = ["region", "area", "territory", "sector", "nation"];

  it("offers territory when granting access in the manage-access modal", async () => {
    render(withProviders(<AdminManageAccessModal data={null} />));

    await waitFor(() =>
      expect(orgTypesRequested(mocks.accessible)).toContainEqual(aboveAo),
    );
  });

  it("offers territory in the users modal's accessible organizations", async () => {
    render(withProviders(<AdminUsersModal data={{ id: null }} />));

    await waitFor(() =>
      expect(orgTypesRequested(mocks.accessible)).toContainEqual(aboveAo),
    );
  });

  it("offers territory in the event-types organization filter", async () => {
    render(
      withProviders(
        <EventTypesOrgFilter onOrgSelect={vi.fn()} selectedOrgs={[]} />,
      ),
    );

    await waitFor(() =>
      expect(orgTypesRequested(mocks.accessible)).toEqual([aboveAo]),
    );
  });

  it("offers territory but not nation by default in the users organization filter", async () => {
    render(
      withProviders(<UsersOrgFilter onOrgSelect={vi.fn()} selectedOrgs={[]} />),
    );

    await waitFor(() =>
      expect(orgTypesRequested(mocks.all)).toEqual([
        ["region", "area", "territory", "sector"],
      ]),
    );
  });

  it("still honors explicit organization types in the users organization filter", async () => {
    render(
      withProviders(
        <UsersOrgFilter
          onOrgSelect={vi.fn()}
          selectedOrgs={[]}
          orgTypes={["region"]}
        />,
      ),
    );

    await waitFor(() =>
      expect(orgTypesRequested(mocks.all)).toEqual([["region"]]),
    );
  });
});
