import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModalSwitcher } from "~/app/_components/modal/modal-switcher";
import { closeModal, ModalType, openModal } from "~/utils/store/modal";

vi.mock("~/app/_components/modal/admin-org-edit-modal", () => ({
  default: (props: { orgType: string; id?: number; isProd: boolean }) => (
    <div data-testid="organization-editor">{JSON.stringify(props)}</div>
  ),
}));
vi.mock("~/app/_components/modal/admin-oauth-clients-modal", () => ({
  default: ({ data }: { data: { clientId: string } }) => (
    <div data-testid="oauth-editor">{data.clientId}</div>
  ),
}));
vi.mock("~/app/_components/modal/admin-api-keys-modal", () => ({
  default: () => <div data-testid="api-keys-editor" />,
}));
vi.mock("~/app/_components/modal/admin-positions-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-delete-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-event-instances-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-event-types-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-locations-modal", () => ({
  default: (props: {
    data: { id?: number };
    googleApiKey: string;
    isProd: boolean;
  }) => <div data-testid="location-editor">{JSON.stringify(props)}</div>,
}));
vi.mock("~/app/_components/modal/admin-manage-access-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-requests-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-users-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/admin-workouts-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/delete-modal", () => ({
  default: () => null,
}));
vi.mock("~/app/_components/modal/full-image-modal", () => ({
  FullImageModal: () => null,
}));
vi.mock("~/app/_components/modal/qr-code-modal", () => ({
  QRCodeModal: () => null,
}));
vi.mock("~/app/_components/modal/sign-in-modal", () => ({
  default: () => null,
}));

const runtimeConfig = { googleApiKey: "synthetic-test-key", isProd: true };

afterEach(() => {
  cleanup();
  closeModal(undefined, "all");
});

describe("organization and OAuth modal integration", () => {
  it("renders nothing when the modal stack is empty", () => {
    const view = render(<ModalSwitcher runtimeConfig={runtimeConfig} />);
    expect(view.container.textContent).toBe("");
  });

  it.each(["nation", "sector", "area", "region", "ao"] as const)(
    "dispatches the %s editor with its identity and runtime setting",
    (orgType) => {
      openModal(ModalType.ADMIN_ORG, { orgType, id: 40 });
      render(<ModalSwitcher runtimeConfig={runtimeConfig} />);
      expect(
        JSON.parse(screen.getByTestId("organization-editor").textContent),
      ).toEqual({
        orgType,
        id: 40,
        isProd: true,
      });
      expect(screen.queryByTestId("oauth-editor")).toBeNull();
    },
  );

  it("dispatches an OAuth client and restores the organization editor below it", () => {
    openModal(ModalType.ADMIN_ORG, { orgType: "region", id: 40 });
    openModal(ModalType.ADMIN_OAUTH_CLIENTS, { clientId: "synthetic-client" });
    render(<ModalSwitcher runtimeConfig={runtimeConfig} />);
    expect(screen.getByTestId("oauth-editor").textContent).toBe(
      "synthetic-client",
    );
    expect(screen.queryByTestId("organization-editor")).toBeNull();
    act(() => closeModal());
    expect(
      JSON.parse(screen.getByTestId("organization-editor").textContent),
    ).toMatchObject({
      orgType: "region",
      id: 40,
    });
    expect(screen.queryByTestId("oauth-editor")).toBeNull();
  });

  it("keeps API-key creation distinct from OAuth editing", () => {
    openModal(ModalType.ADMIN_API_KEYS);
    render(<ModalSwitcher runtimeConfig={runtimeConfig} />);
    expect(screen.getByTestId("api-keys-editor")).toBeTruthy();
    expect(screen.queryByTestId("oauth-editor")).toBeNull();
  });

  it("retains location data and runtime configuration after closing OAuth", () => {
    openModal(ModalType.ADMIN_LOCATIONS, { id: 80 });
    openModal(ModalType.ADMIN_OAUTH_CLIENTS, { clientId: "synthetic-client" });
    render(<ModalSwitcher runtimeConfig={runtimeConfig} />);
    expect(screen.getByTestId("oauth-editor").textContent).toBe(
      "synthetic-client",
    );
    act(() => closeModal());
    expect(
      JSON.parse(screen.getByTestId("location-editor").textContent),
    ).toEqual({
      data: { id: 80 },
      googleApiKey: runtimeConfig.googleApiKey,
      isProd: true,
    });
    expect(screen.queryByTestId("oauth-editor")).toBeNull();
  });
});
