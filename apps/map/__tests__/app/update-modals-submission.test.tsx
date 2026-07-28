import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../setup";
import {
  aoFields,
  base,
  eventFields,
  locationFields,
} from "../utils/request-schema-fixtures";

// --- Hoisted spies --------------------------------------------------------
const { stub, clientCalls, clientRequest, closeModal, toast, refresh } =
  vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: Record<string, ReturnType<typeof vi.fn<any>>> = {};
    return {
      stub: (name: string) => () => <div data-testid={name} />,
      clientCalls: calls,
      // Lazily create + cache a resolved spy per `submit*` method so tests can
      // assert which one a modal invoked.
      clientRequest: new Proxy(
        {},
        {
          get: (_t, prop) => {
            const key = String(prop);
            calls[key] ??= vi.fn().mockResolvedValue({ status: "pending" });
            return calls[key];
          },
        },
      ),
      closeModal: vi.fn(),
      toast: { success: vi.fn(), error: vi.fn() },
      refresh: vi.fn(),
    };
  });

// Stub the field children; keep the REAL SubmitSection so submission runs.
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
// Resolve the shared-location check as "not shared" on mount so the modal's
// fail-closed submit gate opens (mirrors a successful, non-shared lookup).
vi.mock("~/app/_components/forms/linked-aos-notice", () => {
  const { useEffect } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react") as {
      useEffect: (effect: () => void, deps?: readonly unknown[]) => void;
    };
  return {
    LinkedAosNotice: ({
      onSharedChange,
    }: {
      onSharedChange?: (shared: boolean) => void;
    }) => {
      useEffect(() => onSharedChange?.(false), [onSharedChange]);
      return <div data-testid="linked-aos-notice" />;
    },
  };
});
vi.mock("~/app/_components/forms/form-inputs/region-and-ao-selector", () => ({
  RegionAndAOSelector: stub("region-and-ao"),
}));
vi.mock("~/app/_components/forms/form-inputs/region-ao-event-selector", () => ({
  RegionAOEventSelector: stub("region-ao-event"),
}));
vi.mock("~/app/_components/forms/form-inputs/region-selector", () => ({
  RegionSelector: stub("region"),
}));

vi.mock("~/orpc/client", () => ({
  client: { request: clientRequest },
}));

// SubmitSection's data hooks – no permission check, no real mutation.
vi.mock("~/orpc/react", () => ({
  useQuery: () => ({ data: { results: [] } }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
  invalidateQueries: vi.fn(),
  orpc: {
    request: {
      canEditRegions: { queryOptions: () => ({}) },
      rejectSubmission: { mutationOptions: () => ({}) },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@acme/ui/toast", () => ({ toast }));

// Keep the real modal store but spy closeModal (called after a successful submit).
vi.mock("~/utils/store/modal", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, closeModal };
});

import { CreateAOAndLocationAndEventModal } from "~/app/_components/modal/update/create-ao-and-location-and-event-modal";
import { CreateEventModal } from "~/app/_components/modal/update/create-event-modal";
import { DeleteAoModal } from "~/app/_components/modal/update/delete-ao-modal";
import { DeleteEventModal } from "~/app/_components/modal/update/delete-event-modal";
import { EditAoAndLocationModal } from "~/app/_components/modal/update/edit-ao-and-location-modal";
import { EditAoModal } from "~/app/_components/modal/update/edit-ao-modal";
import { EditEventModal } from "~/app/_components/modal/update/edit-event-modal";
import { EditLocationModal } from "~/app/_components/modal/update/edit-location-modal";
import { MoveAOToDifferentLocationModal } from "~/app/_components/modal/update/move-ao-to-different-location-modal";
import { MoveAOToDifferentRegionModal } from "~/app/_components/modal/update/move-ao-to-different-region-modal";
import { MoveAOToNewLocationModal } from "~/app/_components/modal/update/move-ao-to-new-location-modal";
import { MoveEventToDifferentAoModal } from "~/app/_components/modal/update/move-event-to-different-ao-modal";
import { MoveEventToNewAoModal } from "~/app/_components/modal/update/move-event-to-new-ao-modal";
import { MoveEventToNewLocationModal } from "~/app/_components/modal/update/move-event-to-new-location-modal";

// Valid form data per modal (built from the shared schema fixtures) so
// react-hook-form's zod validation passes and the success path runs.
const cases: {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Modal: (props: { data: any }) => React.JSX.Element;
  buttonText: string;
  clientMethod: string;
  data: Record<string, unknown>;
}[] = [
  {
    name: "CreateAOAndLocationAndEvent",
    Modal: CreateAOAndLocationAndEventModal,
    buttonText: "Create New Location, AO & Workout",
    clientMethod: "submitCreateAOAndLocationAndEventRequest",
    data: {
      ...base,
      ...eventFields,
      ...aoFields,
      ...locationFields,
      requestType: "create_ao_and_location_and_event",
    },
  },
  {
    name: "CreateEvent",
    Modal: CreateEventModal,
    buttonText: "Create New Event",
    clientMethod: "submitCreateEventRequest",
    data: {
      ...base,
      ...eventFields,
      requestType: "create_event",
      originalAoId: 30,
      originalLocationId: 10,
    },
  },
  {
    name: "DeleteAo",
    Modal: DeleteAoModal,
    buttonText: "Delete AO",
    clientMethod: "submitDeleteAORequest",
    data: { ...base, requestType: "delete_ao", originalAoId: 30 },
  },
  {
    name: "DeleteEvent",
    Modal: DeleteEventModal,
    buttonText: "Delete Event",
    clientMethod: "submitDeleteEventRequest",
    data: { ...base, requestType: "delete_event", originalEventId: 20 },
  },
  {
    name: "EditAoAndLocation",
    Modal: EditAoAndLocationModal,
    buttonText: "Update AO and Location",
    clientMethod: "submitEditAOAndLocationRequest",
    data: {
      ...base,
      ...aoFields,
      ...locationFields,
      requestType: "edit_ao_and_location",
      originalAoId: 30,
      originalLocationId: 10,
      currentValues: {},
    },
  },
  {
    name: "EditAo",
    Modal: EditAoModal,
    buttonText: "Update AO",
    clientMethod: "submitEditAORequest",
    data: {
      ...base,
      ...aoFields,
      requestType: "edit_ao",
      originalAoId: 30,
      currentValues: {},
    },
  },
  {
    name: "EditLocation",
    Modal: EditLocationModal,
    buttonText: "Update Location",
    clientMethod: "submitEditLocationRequest",
    data: {
      ...base,
      ...locationFields,
      requestType: "edit_location",
      originalLocationId: 10,
      currentValues: {},
    },
  },
  {
    name: "EditEvent",
    Modal: EditEventModal,
    buttonText: "Edit Workout Details",
    clientMethod: "submitEditEventRequest",
    data: {
      ...base,
      requestType: "edit_event",
      originalEventId: 20,
      currentValues: {},
    },
  },
  {
    name: "MoveAOToDifferentLocation",
    Modal: MoveAOToDifferentLocationModal,
    buttonText: "Move AO to Different Location",
    clientMethod: "submitMoveAOToDifferentLocationRequest",
    data: {
      ...base,
      requestType: "move_ao_to_different_location",
      originalAoId: 30,
      originalLocationId: 10,
      newLocationId: 11,
    },
  },
  {
    name: "MoveAOToDifferentRegion",
    Modal: MoveAOToDifferentRegionModal,
    buttonText: "Move AO to Different Region",
    clientMethod: "submitMoveAOToDifferentRegionRequest",
    data: {
      ...base,
      requestType: "move_ao_to_different_region",
      newRegionId: 6,
      originalAoId: 30,
    },
  },
  {
    name: "MoveAOToNewLocation",
    Modal: MoveAOToNewLocationModal,
    buttonText: "Move AO to New Location",
    clientMethod: "submitMoveAOToNewLocationRequest",
    data: {
      ...base,
      ...locationFields,
      requestType: "move_ao_to_new_location",
      originalAoId: 30,
      originalLocationId: 10,
      currentValues: {},
    },
  },
  {
    name: "MoveEventToDifferentAo",
    Modal: MoveEventToDifferentAoModal,
    buttonText: "Move Event to Different AO",
    clientMethod: "submitMoveEventToDifferentAoRequest",
    data: {
      ...base,
      requestType: "move_event_to_different_ao",
      originalEventId: 20,
      originalAoId: 30,
      newAoId: 31,
    },
  },
  {
    name: "MoveEventToNewAo",
    Modal: MoveEventToNewAoModal,
    buttonText: "Move Event to New AO",
    clientMethod: "submitMoveEventToNewAoRequest",
    data: {
      ...base,
      ...eventFields,
      ...aoFields,
      ...locationFields,
      requestType: "move_event_to_new_ao",
      originalEventId: 20,
      originalAoId: 30,
      originalLocationId: 10,
      newLocationId: 11,
    },
  },
  {
    name: "MoveEventToNewLocation",
    Modal: MoveEventToNewLocationModal,
    buttonText: "Move Event to New Location",
    clientMethod: "submitMoveEventToNewLocationRequest",
    data: {
      ...base,
      ...locationFields,
      requestType: "move_event_to_new_location",
      originalEventId: 20,
      originalLocationId: 10,
      currentValues: {},
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(clientCalls).forEach((k) => delete clientCalls[k]);
});

describe("update modal submission", () => {
  it.each(cases)(
    "$name submits valid data via the correct client method",
    async ({ Modal, buttonText, clientMethod, data }) => {
      renderWithProviders(<Modal data={data} />);

      fireEvent.click(screen.getByRole("button", { name: buttonText }));

      await waitFor(() => expect(clientCalls[clientMethod]).toHaveBeenCalled());

      // Submitted with the request type echoed back, then success feedback shown.
      expect(clientCalls[clientMethod]).toHaveBeenCalledWith(
        expect.objectContaining({ requestType: data.requestType }),
      );
      expect(toast.success).toHaveBeenCalled();
      expect(closeModal).toHaveBeenCalled();
    },
  );
});
