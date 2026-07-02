// Mock setups use vi.fn() with untyped callbacks — unsafe rules don't apply here
/* eslint-disable @typescript-eslint/no-explicit-any */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../setup";

// Stub the form-input children so each modal renders only its own markup.
// Defined via vi.hoisted so it's available inside the hoisted vi.mock factories.
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => <div data-testid={name} />,
}));

vi.mock("~/app/_components/forms/submit-section", () => ({
  SubmitSection: stub("submit-section"),
}));
vi.mock("~/app/_components/forms/dev-debug-component", () => ({
  FormDebugData: stub("form-debug"),
  DevLoadTestData: stub("dev-load-test"),
}));
vi.mock("~/app/_components/forms/form-inputs/ao-details-form", () => ({
  AODetailsForm: stub("ao-details"),
}));
vi.mock("~/app/_components/forms/form-inputs/contact-details-form", () => ({
  ContactDetailsForm: stub("contact-details"),
}));
vi.mock("~/app/_components/forms/form-inputs/delete-ao-form", () => ({
  DeleteAoForm: stub("delete-ao"),
}));
vi.mock("~/app/_components/forms/form-inputs/delete-event-form", () => ({
  DeleteEventForm: stub("delete-event"),
}));
vi.mock("~/app/_components/forms/form-inputs/event-details-form", () => ({
  EventDetailsForm: stub("event-details"),
}));
vi.mock(
  "~/app/_components/forms/form-inputs/existing-location-picker-form",
  () => ({
    ExistingLocationPickerForm: stub("existing-location-picker"),
  }),
);
vi.mock("~/app/_components/forms/form-inputs/in-region-form", () => ({
  InRegionForm: stub("in-region"),
}));
vi.mock("~/app/_components/forms/form-inputs/location-details-form", () => ({
  LocationDetailsForm: stub("location-details"),
}));
vi.mock("~/app/_components/forms/form-inputs/region-and-ao-selector", () => ({
  RegionAndAOSelector: stub("region-and-ao"),
}));
vi.mock("~/app/_components/forms/form-inputs/region-ao-event-selector", () => ({
  RegionAOEventSelector: stub("region-ao-event"),
}));
vi.mock("~/app/_components/forms/form-inputs/region-selector", () => ({
  RegionSelector: stub("region"),
}));

// oRPC client – any `submit*` request method resolves to a no-op spy.
vi.mock("~/orpc/client", () => ({
  client: {
    request: new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) }),
  },
}));

import { CreateAOAndLocationAndEventModal } from "~/app/_components/modal/update/create-ao-and-location-and-event-modal";
import { CreateEventModal } from "~/app/_components/modal/update/create-event-modal";
import { DeleteAoModal } from "~/app/_components/modal/update/delete-ao-modal";
import { DeleteEventModal } from "~/app/_components/modal/update/delete-event-modal";
import { EditAoAndLocationModal } from "~/app/_components/modal/update/edit-ao-and-location-modal";
import { EditEventModal } from "~/app/_components/modal/update/edit-event-modal";
import { MoveAOToDifferentLocationModal } from "~/app/_components/modal/update/move-ao-to-different-location-modal";
import { MoveAOToDifferentRegionModal } from "~/app/_components/modal/update/move-ao-to-different-region-modal";
import { MoveAOToNewLocationModal } from "~/app/_components/modal/update/move-ao-to-new-location-modal";
import { MoveEventToDifferentAoModal } from "~/app/_components/modal/update/move-event-to-different-ao-modal";
import { MoveEventToNewAoModal } from "~/app/_components/modal/update/move-event-to-new-ao-modal";
import { MoveEventToNewLocationModal } from "~/app/_components/modal/update/move-event-to-new-location-modal";

// Each modal only forwards `data` to react-hook-form's defaultValues; the field
// values themselves are exercised by the child forms (stubbed here), so an empty
// object is sufficient to render the modal shell.
const cases: [string, (props: { data: any }) => React.ReactNode, string][] = [
  [
    "CreateAOAndLocationAndEventModal",
    CreateAOAndLocationAndEventModal,
    "New Location, AO & Event",
  ],
  ["CreateEventModal", CreateEventModal, "Create New Event"],
  ["DeleteAoModal", DeleteAoModal, "Delete AO"],
  ["DeleteEventModal", DeleteEventModal, "Delete Event"],
  ["EditAoAndLocationModal", EditAoAndLocationModal, "Edit AO Details"],
  ["EditEventModal", EditEventModal, "Edit workout details"],
  [
    "MoveAOToDifferentLocationModal",
    MoveAOToDifferentLocationModal,
    "Move AO to Different Location",
  ],
  [
    "MoveAOToDifferentRegionModal",
    MoveAOToDifferentRegionModal,
    "Move to different region",
  ],
  [
    "MoveAOToNewLocationModal",
    MoveAOToNewLocationModal,
    "Move AO to New Location",
  ],
  [
    "MoveEventToDifferentAoModal",
    MoveEventToDifferentAoModal,
    "Move Event to Different AO",
  ],
  ["MoveEventToNewAoModal", MoveEventToNewAoModal, "Move Event to New AO"],
  [
    "MoveEventToNewLocationModal",
    MoveEventToNewLocationModal,
    "Move Event to New Location",
  ],
];

describe("update modals render", () => {
  it.each(cases)("%s renders its title", (_name, Modal, title) => {
    renderWithProviders(<Modal data={{}} />);
    expect(screen.getByText(title)).toBeInTheDocument();
  });
});
