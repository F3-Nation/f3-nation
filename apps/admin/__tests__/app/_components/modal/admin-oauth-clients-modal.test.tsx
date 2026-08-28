import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock("~/orpc/react", () => ({
  invalidateQueries: vi.fn(),
  useQuery: useQueryMock,
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  orpc: {
    oauthClient: {
      list: { queryOptions: () => ({ queryKey: ["oauthClient.list"] }) },
      create: { mutationOptions: () => ({}) },
      update: { mutationOptions: () => ({}) },
    },
  },
}));

vi.mock("~/utils/store/modal", () => ({
  closeModal: vi.fn(),
}));

describe("AdminOauthClientsModal", () => {
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
});
