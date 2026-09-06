import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OauthClientsTable } from "~/app/oauth-clients/oauth-clients-table";

// jsdom has no ResizeObserver, and Radix's DropdownMenu needs one to position
// its portaled content. jsdom also lacks pointer capture and scrollIntoView,
// which Radix's trigger/item pointer handling calls unconditionally.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        /* no-op */
      }
      unobserve() {
        /* no-op */
      }
      disconnect() {
        /* no-op */
      }
    },
  );
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {
      /* no-op */
    },
    releasePointerCapture: () => {
      /* no-op */
    },
    scrollIntoView: () => {
      /* no-op */
    },
  });
});

const { useQueryMock, invalidateQueriesMock, updateMutate } = vi.hoisted(
  () => ({
    useQueryMock: vi.fn(),
    invalidateQueriesMock: vi.fn(),
    updateMutate: vi.fn<(variables: unknown) => void>(),
  }),
);

interface MutationOptions {
  onSuccess?: (result: unknown, variables: unknown) => unknown;
  onError?: (error: unknown, variables: unknown) => unknown;
}

vi.mock("~/orpc/react", () => ({
  invalidateQueries: invalidateQueriesMock,
  useQuery: useQueryMock,
  useMutation: (options: MutationOptions) => ({
    mutate: (variables: unknown) => {
      updateMutate(variables);
      try {
        options.onSuccess?.({}, variables);
      } catch (err) {
        options.onError?.(err, variables);
      }
    },
  }),
  orpc: {
    oauthClient: {
      list: { queryOptions: () => ({ queryKey: ["oauthClient.list"] }) },
      update: {
        mutationOptions: (opts: MutationOptions) => opts,
      },
    },
  },
}));

describe("OauthClientsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(screen.queryByText("No OAuth clients registered.")).toBeNull();
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

    expect(screen.getByText("No OAuth clients registered.")).toBeTruthy();
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

  it("disables an active client from the row menu and invalidates the list", async () => {
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
    });

    render(<OauthClientsTable />);

    const menuButton = screen.getByRole("button", { name: "Open menu" });
    fireEvent.pointerDown(menuButton, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(menuButton, { pointerId: 1, button: 0 });
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByText("Disable"));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        disabled: true,
      });
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith("oauthClient");
  });

  it("re-enables a disabled client from the row menu", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
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

    const menuButton = screen.getByRole("button", { name: "Open menu" });
    fireEvent.pointerDown(menuButton, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(menuButton, { pointerId: 1, button: 0 });
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByText("Re-enable"));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        clientId: "mobile-client",
        disabled: false,
      });
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith("oauthClient");
  });
});
