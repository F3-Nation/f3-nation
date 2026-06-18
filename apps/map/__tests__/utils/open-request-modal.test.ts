import type { RequestType } from "@acme/shared/app/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted spies / mock state -------------------------------------------
const h = vi.hoisted(() => {
  const mapState: {
    updateLocation: { lat: number; lng: number } | null;
    modifiedLocationMarkers: Record<string, unknown>;
    center: { lat: number; lng: number };
  } = {
    updateLocation: { lat: 1, lng: 2 },
    modifiedLocationMarkers: {},
    center: { lat: 0, lng: 0 },
  };
  return {
    openModal: vi.fn(),
    toastError: vi.fn(),
    getSession: vi.fn(),
    getQueryData: vi.fn(),
    locationWorkout: vi.fn(),
    mapState,
  };
});

// next-auth session (used to populate `submittedBy`)
vi.mock("next-auth/react", () => ({
  getSession: h.getSession,
}));

// Deterministic uuid so generated ids don't matter
vi.mock("uuid", () => ({ v4: () => "test-uuid" }));

// Toast – we only care that an error was raised
vi.mock("@acme/ui/toast", () => ({
  toast: { error: h.toastError },
}));

vi.mock("@acme/shared/app/functions", () => ({
  requestTypeToTitle: (t: string) => t,
}));

// oRPC client + query cache
vi.mock("~/orpc/client", () => ({
  client: { map: { location: { locationWorkout: h.locationWorkout } } },
}));
vi.mock("~/orpc/react", () => ({
  getQueryData: h.getQueryData,
  orpc: {
    map: { location: { locationWorkout: { queryKey: () => ["k"] } } },
  },
}));

// Map store – key-based lookup driven by `h.mapState`
vi.mock("~/utils/store/map", () => ({
  mapStore: { get: (key: keyof typeof h.mapState) => h.mapState[key] },
}));

// Modal store – keep the real ModalType enum, spy on openModal
vi.mock("~/utils/store/modal", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("~/utils/store/modal")>();
  return { ...actual, openModal: h.openModal };
});

import { openRequestModal } from "~/utils/open-request-modal";
import { ModalType } from "~/utils/store/modal";

// A location with everything downstream code reads, so the id guards pass.
const LOCATION = {
  regionId: 5,
  lat: 35.5,
  lon: -80.5,
  events: [
    {
      id: 20,
      name: "Event",
      startTime: "0600",
      endTime: "0645",
      dayOfWeek: "monday",
      description: "desc",
      eventTypes: [{ id: 1 }],
      aoName: "AO",
      aoLogo: null,
      aoWebsite: null,
    },
  ],
  locationAddress: "123 Main St",
};

const BASE_PARAMS = {
  locationId: 10,
  eventId: 20,
  aoId: 30,
  meta: {
    originalRegionId: 5,
    originalAoId: 30,
    originalLocationId: 10,
    originalEventId: 20,
    newRegionId: 6,
    newAoId: 31,
    newLocationId: 11,
  },
};

const run = (type: RequestType, overrides = {}) =>
  openRequestModal({ type, ...BASE_PARAMS, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue({ email: "tester@example.com" });
  h.getQueryData.mockReturnValue({ location: LOCATION });
  h.mapState = {
    updateLocation: { lat: 1, lng: 2 },
    modifiedLocationMarkers: {},
    center: { lat: 0, lng: 0 },
  };
});

describe("openRequestModal – request type -> modal type mapping", () => {
  const cases: [RequestType, ModalType][] = [
    [
      "create_ao_and_location_and_event",
      ModalType.CREATE_AO_AND_LOCATION_AND_EVENT,
    ],
    ["move_ao_to_new_location", ModalType.MOVE_AO_TO_NEW_LOCATION],
    ["move_event_to_new_location", ModalType.MOVE_EVENT_TO_NEW_LOCATION],
    ["create_event", ModalType.CREATE_EVENT],
    ["edit_event", ModalType.EDIT_EVENT],
    ["edit_ao_and_location", ModalType.EDIT_AO_AND_LOCATION],
    ["move_ao_to_different_region", ModalType.MOVE_AO_TO_DIFFERENT_REGION],
    ["move_ao_to_different_location", ModalType.MOVE_AO_TO_DIFFERENT_LOCATION],
    ["move_event_to_different_ao", ModalType.MOVE_EVENT_TO_DIFFERENT_AO],
    ["move_event_to_new_ao", ModalType.MOVE_EVENT_TO_NEW_AO],
    ["delete_ao", ModalType.DELETE_AO],
    ["delete_event", ModalType.DELETE_EVENT],
  ];

  it.each(cases)(
    "%s opens the %s modal",
    async (requestType, expectedModal) => {
      await run(requestType);

      // Loading modal is always opened first for UX.
      expect(h.openModal).toHaveBeenCalledWith(ModalType.LOADING, undefined);
      // The target modal is opened with the request type echoed back.
      expect(h.openModal).toHaveBeenLastCalledWith(
        expectedModal,
        expect.objectContaining({ requestType }),
      );
      expect(h.toastError).not.toHaveBeenCalled();
    },
  );
});

describe("openRequestModal – validation guards", () => {
  it("toasts and aborts create_ao_and_location_and_event when no marker exists", async () => {
    h.mapState.updateLocation = null;
    await run("create_ao_and_location_and_event");

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.CREATE_AO_AND_LOCATION_AND_EVENT,
      expect.anything(),
    );
  });

  it("toasts when create_event is missing the region id", async () => {
    h.getQueryData.mockReturnValue({
      location: { ...LOCATION, regionId: undefined },
    });
    await run("create_event");

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.CREATE_EVENT,
      expect.anything(),
    );
  });

  it("toasts when create_event is missing the ao id", async () => {
    await run("create_event", { aoId: null });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.CREATE_EVENT,
      expect.anything(),
    );
  });

  it("toasts when edit_event is missing the event id", async () => {
    await run("edit_event", { eventId: null });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.EDIT_EVENT,
      expect.anything(),
    );
  });

  it("toasts when edit_ao_and_location is missing the location id", async () => {
    await run("edit_ao_and_location", { locationId: null });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.EDIT_AO_AND_LOCATION,
      expect.anything(),
    );
  });

  it("toasts when move_event_to_new_ao is missing the event id", async () => {
    await run("move_event_to_new_ao", { eventId: null });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalledWith(
      ModalType.MOVE_EVENT_TO_NEW_AO,
      expect.anything(),
    );
  });
});

describe("openRequestModal – legacy & unknown types", () => {
  it("alerts on the legacy `edit` type without opening a modal", async () => {
    const alertSpy = vi
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    await run("edit");

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // Only the loading modal should have been opened.
    expect(h.openModal).toHaveBeenCalledTimes(1);
    expect(h.openModal).toHaveBeenCalledWith(ModalType.LOADING, undefined);
    alertSpy.mockRestore();
  });

  it("throws for an unimplemented request type", async () => {
    await expect(run("not_a_real_type" as RequestType)).rejects.toThrow(
      "Not implemented",
    );
  });
});
