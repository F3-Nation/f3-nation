import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OauthClientsTable } from "~/app/oauth-clients/oauth-clients-table";

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock("~/orpc/react", () => ({
  invalidateQueries: vi.fn(),
  useQuery: useQueryMock,
  useMutation: () => ({ mutate: vi.fn() }),
  orpc: {
    oauthClient: {
      list: { queryOptions: () => ({ queryKey: ["oauthClient.list"] }) },
      update: { mutationOptions: () => ({}) },
    },
  },
}));

describe("OauthClientsTable", () => {
  it("shows a loading spinner while the client list is loading", () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = render(<OauthClientsTable />);

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows an error state instead of the empty state when the query fails", () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<OauthClientsTable />);

    expect(screen.getByText("Unable to load OAuth clients.")).toBeTruthy();
    expect(screen.queryByText("No OAuth clients yet.")).toBeNull();
  });

  it("keeps showing cached rows, not the error state, when a background refetch fails", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            isPublic: false,
            disabled: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      isLoading: false,
      isError: true,
    });

    render(<OauthClientsTable />);

    expect(screen.getByText("Paxvault")).toBeTruthy();
    expect(screen.queryByText("Unable to load OAuth clients.")).toBeNull();
  });

  it("shows an empty state when there are no clients", () => {
    useQueryMock.mockReturnValue({ data: { clients: [] }, isLoading: false });

    render(<OauthClientsTable />);

    expect(screen.getByText("No OAuth clients yet.")).toBeTruthy();
  });

  it("renders a client row with its name, id, type badge, and status", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            isPublic: false,
            disabled: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            clientId: "mobile-client",
            name: null,
            redirectUris: ["com.f3nation.app:/callback"],
            isPublic: true,
            disabled: true,
            createdAt: null,
          },
        ],
      },
      isLoading: false,
    });

    render(<OauthClientsTable />);

    expect(screen.getByText("Paxvault")).toBeTruthy();
    expect(screen.getByText("paxvault-client")).toBeTruthy();
    expect(screen.getByText("Confidential")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();

    expect(screen.getByText("mobile-client")).toBeTruthy();
    expect(screen.getByText("Public (PKCE)")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    // name falls back to an em dash, createdAt to formatDateTime's "—"
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
