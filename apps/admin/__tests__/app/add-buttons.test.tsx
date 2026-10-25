import type { ComponentType } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddEventTypeButton } from "~/app/event-types/add-event-type-button";
import { AddLocationButton } from "~/app/locations/[id]/add-location-button";
import { AddPositionButton } from "~/app/positions/add-position-button";
import { AddWorkoutButton } from "~/app/workouts/[id]/add-workout-button";
import type * as ModalStore from "~/utils/store/modal";
import { ModalType } from "~/utils/store/modal";

const openModal = vi.hoisted(() => vi.fn());

vi.mock("~/utils/store/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof ModalStore>()),
  openModal,
}));

const cases: [string, ComponentType, string, ModalType][] = [
  [
    "AddEventTypeButton",
    AddEventTypeButton,
    "Add Event Type",
    ModalType.ADMIN_EVENT_TYPES,
  ],
  [
    "AddLocationButton",
    AddLocationButton,
    "Add Location",
    ModalType.ADMIN_LOCATIONS,
  ],
  [
    "AddPositionButton",
    AddPositionButton,
    "Add Position",
    ModalType.ADMIN_POSITIONS,
  ],
  ["AddWorkoutButton", AddWorkoutButton, "Add Event", ModalType.ADMIN_EVENTS],
];

describe.each(cases)("%s", (_, Button, name, modal) => {
  it("opens its modal for a new record", () => {
    render(<Button />);

    fireEvent.click(screen.getByRole("button", { name }));

    expect(openModal).toHaveBeenCalledWith(modal, { id: undefined });
  });
});
