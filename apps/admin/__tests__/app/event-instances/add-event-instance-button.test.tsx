import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddEventInstanceButton } from "~/app/event-instances/add-event-instance-button";
import { ModalType } from "~/utils/store/modal";

const openModal = vi.hoisted(() => vi.fn());

vi.mock("~/utils/store/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/store/modal")>()),
  openModal,
}));

describe("AddEventInstanceButton", () => {
  it("opens the event instance modal for a new instance", () => {
    render(<AddEventInstanceButton />);

    fireEvent.click(screen.getByRole("button", { name: "Add Event Instance" }));

    expect(openModal).toHaveBeenCalledWith(ModalType.ADMIN_EVENT_INSTANCES, {
      id: undefined,
    });
  });
});
