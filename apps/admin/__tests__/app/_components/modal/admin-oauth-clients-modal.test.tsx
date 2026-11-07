import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import AdminOauthClientsModal from "~/app/_components/modal/admin-oauth-clients-modal";
import { ORPCError } from "~/orpc/react";

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

const {
  useQueryMock,
  updateMutateAsync,
  closeModalMock,
  isPendingMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  updateMutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(),
  closeModalMock: vi.fn(),
  isPendingMock: vi.fn(() => false),
  toastErrorMock: vi.fn(),
}));

vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

interface MutationOptions {
  onSuccess?: (result: unknown, variables: unknown) => unknown;
  onError?: (error: unknown, variables: unknown) => unknown;
}

// A real orpc/tanstack-query mutation invokes the onSuccess/onError callbacks
// passed to mutationOptions() when mutateAsync settles — the modal's actual
// toast/closeModal side effects live inside those callbacks, so the mock has
// to run them too, not just record that mutateAsync was called.
vi.mock("~/orpc/react", async () => ({
  ORPCError: (await import("@orpc/client")).ORPCError,
  invalidateQueries: vi.fn(),
  useQuery: useQueryMock,
  useMutation: (options: MutationOptions) => ({
    isPending: isPendingMock(),
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
    isPendingMock.mockReturnValue(false);
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

  it("closes when the dialog is dismissed via Escape", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });

    expect(closeModalMock).toHaveBeenCalled();
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

    // The dialog's own X button also has an accessible name of "Close" (via
    // an sr-only span), so scope the query to the not-found state's own
    // container rather than matching by name alone.
    const notFoundContainer = screen
      .getByText("This client could not be found.")
      .closest("div");
    if (!notFoundContainer) throw new Error("not-found container not found");
    fireEvent.click(
      within(notFoundContainer).getByRole("button", { name: "Close" }),
    );
    expect(closeModalMock).toHaveBeenCalled();
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

  it("leaves unsupported stored scopes untouched when offline_access is unchanged", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "profile", "email", "custom:read"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
  });

  it("does not resend scopes for a narrow client when offline_access is unchanged", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
  });

  it("lets a client without openid be renamed without touching its scopes", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["custom:read"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
      });
    });
    expect(closeModalMock).toHaveBeenCalled();
  });

  it("sends the stored scopes plus offline_access when the checkbox is turned on", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
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
        scopes: ["openid", "offline_access"],
      });
    });
  });

  it("closes without submitting when Close is clicked in the edit form", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    // The dialog's own X button also has an accessible name of "Close" (via
    // an sr-only span), so scope the query to the form's own button row
    // (identified via its "Save changes" sibling) rather than matching by
    // name alone.
    const buttonRow = screen.getByText("Save changes").closest("div");
    if (!buttonRow) throw new Error("form button row not found");
    fireEvent.click(within(buttonRow).getByRole("button", { name: "Close" }));

    expect(closeModalMock).toHaveBeenCalled();
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("shows a failure toast and does not submit when a required field is cleared", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeTruthy();
    });
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(closeModalMock).not.toHaveBeenCalled();
  });

  it("renders a client with a null name and null scopes without crashing", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: null,
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: null,
            isPublic: false,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(
      screen
        .getByRole("checkbox", { name: /offline_access scope/i })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("submits an edit for a client with null scopes without crashing", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: null,
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
      });
    });
  });

  it("shows a saving state on the submit button while the update mutation is pending", () => {
    isPendingMock.mockReturnValue(true);
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(screen.getByText("Saving")).toBeTruthy();
    expect(screen.queryByText("Save changes")).toBeNull();
  });

  it("does not clobber an in-progress edit when the client list background-refetches with changed data", () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });

    const { rerender } = render(
      <AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Unsaved Edit" },
    });

    // A background refetch that legitimately changed this client server-side
    // (e.g. another admin's concurrent edit) gives `existing` a new object
    // reference. The form must keep the unsaved local edit rather than
    // silently resetting to the freshly-fetched value.
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Renamed By Someone Else",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });
    rerender(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    expect(screen.getByDisplayValue("Unsaved Edit")).toBeTruthy();
    expect(screen.queryByDisplayValue("Renamed By Someone Else")).toBeNull();
  });

  it("picks up a concurrent offline_access change on untouched fields when the client list background-refetches", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockResolvedValue({});

    const { rerender } = render(
      <AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />,
    );

    // Another admin grants offline_access to this same client. This admin
    // never touches the checkbox, so the refetch should update it rather
    // than leaving it frozen at its stale initial value — a stale value
    // here would get folded back into the fresh scopes on submit and
    // silently revert the other admin's change.
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid", "offline_access"],
            isPublic: false,
          },
        ],
      },
    });
    rerender(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        clientId: "paxvault-client",
        name: "Paxvault",
        redirectUris: ["https://paxvault.example.com/callback"],
        // The checkbox now matches the stored scopes, so nothing to send:
        // the other admin's offline_access grant stays as they left it.
      });
    });
    expect(
      screen
        .getByRole("checkbox", { name: /offline_access scope/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows a failure toast and leaves the modal open when the update mutation rejects", async () => {
    useQueryMock.mockReturnValue({
      data: {
        clients: [
          {
            clientId: "paxvault-client",
            name: "Paxvault",
            redirectUris: ["https://paxvault.example.com/callback"],
            scopes: ["openid"],
            isPublic: false,
          },
        ],
      },
    });
    updateMutateAsync.mockRejectedValue(new Error("network error"));

    render(<AdminOauthClientsModal data={{ clientId: "paxvault-client" }} />);

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalled();
    });
    expect(closeModalMock).not.toHaveBeenCalled();
  });

  describe("failure toast", () => {
    const legacyClient = {
      clientId: "legacy-client",
      name: "Legacy",
      redirectUris: ["https://legacy.example.com/callback"],
      scopes: ["openid", "profile", "custom:read"],
      isPublic: false,
    };

    it("says why when a save with an unsupported stored scope is refused", async () => {
      useQueryMock.mockReturnValue({ data: { clients: [legacyClient] } });
      updateMutateAsync.mockRejectedValue(
        new ORPCError("BAD_REQUEST", { message: "Input validation failed" }),
      );

      render(<AdminOauthClientsModal data={{ clientId: "legacy-client" }} />);
      fireEvent.click(
        screen.getByRole("checkbox", { name: /offline_access scope/i }),
      );
      fireEvent.click(screen.getByText("Save changes"));

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "This client has scopes auth3 doesn't support, so offline_access " +
            "can't be changed here. Fix its scopes first.",
        );
      });
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ["openid", "profile", "custom:read", "offline_access"],
        }),
      );
    });

    it("keeps the generic toast when the refused save sent supported scopes only", async () => {
      useQueryMock.mockReturnValue({
        data: { clients: [{ ...legacyClient, scopes: ["openid"] }] },
      });
      updateMutateAsync.mockRejectedValue(
        new ORPCError("BAD_REQUEST", { message: "Input validation failed" }),
      );

      render(<AdminOauthClientsModal data={{ clientId: "legacy-client" }} />);
      fireEvent.click(
        screen.getByRole("checkbox", { name: /offline_access scope/i }),
      );
      fireEvent.click(screen.getByText("Save changes"));

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Unable to update OAuth client",
        );
      });
    });

    it("keeps the generic toast when a non-validation error hits a legacy client", async () => {
      useQueryMock.mockReturnValue({ data: { clients: [legacyClient] } });
      updateMutateAsync.mockRejectedValue(new Error("network error"));

      render(<AdminOauthClientsModal data={{ clientId: "legacy-client" }} />);
      fireEvent.click(
        screen.getByRole("checkbox", { name: /offline_access scope/i }),
      );
      fireEvent.click(screen.getByText("Save changes"));

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Unable to update OAuth client",
        );
      });
    });
  });
});
