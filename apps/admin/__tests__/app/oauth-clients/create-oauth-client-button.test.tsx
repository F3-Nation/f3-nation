import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateOauthClientButton } from "~/app/oauth-clients/create-oauth-client-button";
import { ModalType, openModal } from "~/utils/store/modal";

vi.mock("~/utils/store/modal", () => ({
  ModalType: { ADMIN_OAUTH_CLIENTS: "ADMIN_OAUTH_CLIENTS" },
  openModal: vi.fn(),
}));

describe("CreateOauthClientButton", () => {
  it("opens the OAuth client modal in create mode when clicked", () => {
    render(<CreateOauthClientButton />);

    fireEvent.click(screen.getByRole("button", { name: /new oauth client/i }));

    expect(openModal).toHaveBeenCalledWith(ModalType.ADMIN_OAUTH_CLIENTS, null);
  });
});
