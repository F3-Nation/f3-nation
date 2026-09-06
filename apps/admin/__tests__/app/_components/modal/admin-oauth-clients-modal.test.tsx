import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import AdminOauthClientsModal from "~/app/_components/modal/admin-oauth-clients-modal";

// jsdom has no ResizeObserver; Radix's Checkbox/Dialog primitives need one.
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
});

const { useQueryMock, updateMutateAsync, closeModalMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  updateMutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(),
  closeModalMock: vi.fn(),
}));

interface MutationOptions {
  onSuccess?: (result: unknown, variables: unknown) => unknown;
  onError?: (error: unknown, variables: unknown) => unknown;
}

// A real orpc/tanstack-query mutation invokes the onSuccess/onError callbacks
// passed to mutationOptions() when mutateAsync settles — the modal's actual
// toast/closeModal side effects live inside those callbacks, so the mock has
// to run them too, not just record that mutateAsync was called.
vi.mock("~/orpc/react", () => ({
  invalidateQueries: vi.fn(),
  useQuery: useQueryMock,
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutateAsync: async (variables: unknown) => {
      try {
        const result = await updateMutateAsync(variables);
        await options.onSuccess?.(result, variables);
        return result;
      } catch (err) {
        options.onError?.(err, variables);
        throw err;
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

vi.mock("~/utils/store/modal", () => ({
  closeModal: closeModalMock,
}));

describe("AdminOauthClientsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the edit form pre-filled from the existing client", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "profile", "email", "offline_access"],
            isPublic: true,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(screen.getByText("Edit OAuth Client")).toBeTruthy();
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByDisplayValue("Paxvault")).toBeTruthy();
    expect(screen.getByText("paxvault-client")).toBeTruthy();
    expect(screen.getByText("Public (PKCE)")).toBeTruthy();
  });

  it("shows a loading spinner while the client list is still loading, instead of a blank form", () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    // Dialog content renders into a document.body portal, not the render()
    // container, so the spinner has to be queried from the document.
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("shows an error state when the client list query fails, instead of a blank form", () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(
      screen.getByText("Unable to load this client. Please try again."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("still renders the edit form from cached data when a background refetch fails", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "profile", "email"],
            isPublic: false,
          },
        ],
      },
      isLoading: false,
      isError: true,
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(screen.getByDisplayValue("Paxvault")).toBeTruthy();
    expect(
      screen.queryByText("Unable to load this client. Please try again."),
    ).toBeNull();
  });

  it("shows a not-found state when the target client isn't in the loaded list, instead of a blank form", () => {
    useQueryMock.mockReturnValue({
      data: { clients: [] },
      isLoading: false,
      isError: false,
    });

    render(<AdminOauthClientsModal data={{ clientId: "missing-client" }} />);

    expect(screen.getByText("This client could not be found.")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("submits an edit with offline_access unchecked, dropping the scope, then closes", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "profile", "email", "offline_access"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /offline_access scope/i }),
    );
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
        scopes: ["openid", "profile", "email"],
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
  });

  it("submits an edit with offline_access checked, keeping the scope", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "profile", "email"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /offline_access scope/i }),
    );
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
        scopes: ["openid", "profile", "email", "offline_access"],
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
  });
});
