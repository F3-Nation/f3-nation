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

const { useQueryMock, createMutateAsync, updateMutateAsync, closeModalMock } =
  vi.hoisted(() => ({
    useQueryMock: vi.fn(),
    createMutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(),
    updateMutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(),
    closeModalMock: vi.fn(),
  }));

interface MutationOptions {
  mutationKey: string[];
  onSuccess?: (result: unknown, variables: unknown) => unknown;
  onError?: (error: unknown, variables: unknown) => unknown;
}

// A real orpc/tanstack-query mutation invokes the onSuccess/onError callbacks
// passed to mutationOptions() when mutateAsync settles — the modal's actual
// toast/closeModal/setCreatedSecret side effects live inside those callbacks,
// so the mock has to run them too, not just record that mutateAsync was called.
vi.mock("~/orpc/react", () => ({
  invalidateQueries: vi.fn(),
  useQuery: useQueryMock,
  useMutation: (options: MutationOptions) => {
    const mutateAsync = options.mutationKey.includes("oauthClient.create")
      ? createMutateAsync
      : updateMutateAsync;
    return {
      isPending: false,
      mutateAsync: async (variables: unknown) => {
        try {
          const result = await mutateAsync(variables);
          await options.onSuccess?.(result, variables);
          return result;
        } catch (err) {
          options.onError?.(err, variables);
          throw err;
        }
      },
    };
  },
  orpc: {
    oauthClient: {
      list: { queryOptions: () => ({ queryKey: ["oauthClient.list"] }) },
      create: {
        mutationOptions: (opts: Omit<MutationOptions, "mutationKey">) => ({
          ...opts,
          mutationKey: ["oauthClient.create"],
        }),
      },
      update: {
        mutationOptions: (opts: Omit<MutationOptions, "mutationKey">) => ({
          ...opts,
          mutationKey: ["oauthClient.update"],
        }),
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

  it("renders the create-mode title with an unchecked public-client checkbox, enabled", () => {
    useQueryMock.mockReturnValue({ data: { clients: [] } });

    render(<AdminOauthClientsModal data={null} />);

    expect(screen.getByText("Create OAuth Client")).toBeTruthy();
    expect(screen.getByText("Create client")).toBeTruthy();
    const publicCheckbox = screen.getByRole("checkbox", {
      name: /public client/i,
    });
    expect(publicCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(publicCheckbox.getAttribute("data-disabled")).toBeNull();
  });

  it("renders the edit-mode title pre-filled from the existing client, with the public checkbox locked", () => {
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
    const publicCheckbox = screen.getByRole("checkbox", {
      name: /public client/i,
    });
    expect(publicCheckbox.getAttribute("data-disabled")).not.toBeNull();
  });

  it("submits a new client with offline_access on and reveals the generated secret on success", async () => {
    useQueryMock.mockReturnValue({ data: { clients: [] } });
    createMutateAsync.mockResolvedValue({
      client: { client_secret: "generated-secret-value" },
    });

    render(<AdminOauthClientsModal data={null} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Paxvault" },
    });
    fireEvent.change(screen.getByLabelText("Redirect URIs"), {
      target: { value: "https://paxvault.example.com/callback" },
    });
    fireEvent.click(screen.getByText("Create client"));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
        scope: "openid profile email offline_access",
        isPublic: false,
      });
    });
    expect(await screen.findByText("OAuth Client Created")).toBeTruthy();
    expect(screen.getByText("generated-secret-value")).toBeTruthy();
    expect(updateMutateAsync).not.toHaveBeenCalled();
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
        scope: "openid profile email",
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
});
