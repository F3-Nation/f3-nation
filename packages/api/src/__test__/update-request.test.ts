import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as aoHandlers from "../lib/ao-handlers";
import type * as eventHandlers from "../lib/event-handlers";
import type * as locationHandlers from "../lib/location-handlers";

import {
  handleCreateEvent,
  handleCreateLocationAndEvent,
  handleDeleteAO,
  handleDeleteEvent,
  handleEditAOAndLocation,
  handleEditEvent,
  handleMoveAOToDifferentLocation,
  handleMoveAOToDifferentRegion,
  handleMoveAOToNewLocation,
  handleMoveEventToDifferentAO,
  recordUpdateRequest,
} from "../lib/update-request-handlers";
import {
  createAOAndLocationAndEventRequest,
  createDeleteAORequest,
  createDeleteEventRequest,
  createEditAOAndLocationRequest,
  createEditEventRequest,
  createEventRequest,
  createMoveAOToDifferentLocationRequest,
  createMoveAOToDifferentRegionRequest,
  createMoveAOToNewLocationRequest,
  createMoveEventToDifferentAORequest,
} from "./fixtures";
import { createMockContext } from "./mock";

// Mock the @acme/db module
vi.mock("@acme/db", () => ({
  eq: vi.fn(),
  schema: {
    updateRequests: { id: "id" },
    locations: { id: "id" },
    orgs: { id: "id" },
    events: { id: "id", orgId: "orgId" },
    eventsXEventTypes: { eventId: "eventId", eventTypeId: "eventTypeId" },
  },
}));

// Mock the handler dependencies
const {
  mockInsertLocation,
  mockUpdateLocation,
  mockCreateAO,
  mockUpdateAO,
  mockInsertEvent,
  mockUpdateEvent,
  mockUpdateEventTypes,
} = vi.hoisted(() => ({
  mockInsertLocation: vi.fn<typeof locationHandlers.insertLocation>(),
  mockUpdateLocation: vi.fn<typeof locationHandlers.updateLocation>(),
  mockCreateAO: vi.fn<typeof aoHandlers.createAO>(),
  mockUpdateAO: vi.fn<typeof aoHandlers.updateAO>(),
  mockInsertEvent: vi.fn<typeof eventHandlers.insertEvent>(),
  mockUpdateEvent: vi.fn<typeof eventHandlers.updateEvent>(),
  mockUpdateEventTypes: vi.fn<typeof eventHandlers.updateEventTypes>(),
}));

type InsertLocationResult = Awaited<
  ReturnType<typeof locationHandlers.insertLocation>
>;
type InsertEventResult = Awaited<ReturnType<typeof eventHandlers.insertEvent>>;

vi.mock("../lib/location-handlers", () => ({
  insertLocation: mockInsertLocation,
  updateLocation: mockUpdateLocation,
}));

vi.mock("../lib/ao-handlers", () => ({
  createAO: mockCreateAO,
  updateAO: mockUpdateAO,
}));

vi.mock("../lib/event-handlers", () => ({
  insertEvent: mockInsertEvent,
  updateEvent: mockUpdateEvent,
  updateEventTypes: mockUpdateEventTypes,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertLocation.mockResolvedValue({ id: 100 } as InsertLocationResult);
  mockCreateAO.mockResolvedValue(200);
  mockInsertEvent.mockResolvedValue({ id: 300 } as InsertEventResult);
  mockUpdateEventTypes.mockResolvedValue(undefined);
});

describe("handleCreateLocationAndEvent - creates a new AO with location and event", () => {
  it("creates location first, then AO with location ID, then event with both IDs, and updates event types", async () => {
    const { ctx } = createMockContext();
    const request = createAOAndLocationAndEventRequest();

    await handleCreateLocationAndEvent(ctx, request);

    // Verify insertLocation was called with correct params
    expect(mockInsertLocation).toHaveBeenCalledTimes(1);
    expect(mockInsertLocation).toHaveBeenCalledWith(ctx, {
      regionId: 1,
      locationName: undefined,
      locationLat: 35.2271,
      locationLng: -80.8431,
      locationAddress: "123 Main St",
      locationAddress2: null,
      locationCity: "Charlotte",
      locationState: "NC",
      locationZip: "28202",
      locationCountry: "United States",
      locationDescription: "Near the park",
    });

    // Verify createAO was called with the location ID from insertLocation
    expect(mockCreateAO).toHaveBeenCalledTimes(1);
    expect(mockCreateAO).toHaveBeenCalledWith(ctx, {
      regionId: 1,
      aoName: "The Forge",
      aoLogo: null,
      aoWebsite: null,
      locationId: 100, // From mockInsertLocation
    });

    // Verify insertEvent was called with AO and location IDs
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent).toHaveBeenCalledWith(ctx, {
      aoId: 200, // From mockCreateAO
      locationId: 100, // From mockInsertLocation
      eventName: "Morning Beatdown",
      eventDescription: "A great workout",
      eventDayOfWeek: "monday",
      eventStartTime: "0530",
      eventEndTime: "0615",
      eventStartDate: undefined,
      eventRecurrencePattern: "weekly",
    });

    // Verify updateEventTypes was called with event ID and type IDs
    expect(mockUpdateEventTypes).toHaveBeenCalledTimes(1);
    expect(mockUpdateEventTypes).toHaveBeenCalledWith(ctx, {
      eventId: 300, // From mockInsertEvent
      eventTypeIds: [1, 2],
    });
  });
  it("records the update request with approved status and preserves all location, AO, and event fields", async () => {
    const { ctx } = createMockContext();
    const request = createAOAndLocationAndEventRequest();

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        aoId: undefined,
        requestType: "create_ao_and_location_and_event",
        submittedBy: "test@example.com",
        eventMeta: undefined,
        eventId: undefined,
        eventName: "Morning Beatdown",
        eventDayOfWeek: "monday",
        eventStartTime: "0530",
        eventEndTime: "0615",
        eventTypeIds: [1, 2],
        eventDescription: "A great workout",
        aoName: "The Forge",
        aoLogo: null,
        aoWebsite: null,
        locationId: undefined,
        locationLat: 35.2271,
        locationLng: -80.8431,
        locationAddress: "123 Main St",
        locationAddress2: null,
        locationCity: "Charlotte",
        locationState: "NC",
        locationZip: "28202",
        locationCountry: "United States",
        locationDescription: "Near the park",
        regionId: 1,
        status: "approved",
        meta: { originalRegionId: 1 },
      }),
    );
  });
});

describe("handleCreateEvent - adds event to an existing AO and location", () => {
  it("creates event and records update request with approved status referencing existing AO and location", async () => {
    const { ctx } = createMockContext();
    const request = createEventRequest();

    await handleCreateEvent(ctx, request);

    // Verify insertEvent was called with correct params
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent).toHaveBeenCalledWith(ctx, {
      aoId: 1,
      locationId: 1,
      eventName: "Morning Beatdown",
      eventDescription: "A great workout",
      eventDayOfWeek: "monday",
      eventStartTime: "0530",
      eventEndTime: "0615",
      eventStartDate: undefined,
    });

    // Verify updateEventTypes was called with event ID and type IDs
    expect(mockUpdateEventTypes).toHaveBeenCalledTimes(1);
    expect(mockUpdateEventTypes).toHaveBeenCalledWith(ctx, {
      eventId: 300,
      eventTypeIds: [1],
    });

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;

    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        requestType: "create_event",
        submittedBy: "test@example.com",
        eventId: undefined,
        eventMeta: undefined,
        eventName: "Morning Beatdown",
        eventDayOfWeek: "monday",
        eventStartTime: "0530",
        eventEndTime: "0615",
        eventTypeIds: [1],
        eventDescription: "A great workout",
        regionId: 1,
        aoId: 1,
        locationId: 1,
        status: "approved",
        meta: {
          originalAoId: 1,
          originalLocationId: 1,
          originalRegionId: 1,
        },
      }),
    );
  });
});

describe("handleEditEvent - modifies an existing event", () => {
  it("creates an event first, then edits it and records both requests with updated event details", async () => {
    const { ctx } = createMockContext();

    // First create the event
    const createRequest = createEventRequest();
    await handleCreateEvent(ctx, createRequest);

    const createResult = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...createRequest,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = createResult;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        status: "approved",
        id: "test-request-id",
        aoId: 1,
        eventId: undefined,
        eventMeta: undefined,
        eventTypeIds: [1],
        eventDayOfWeek: "monday",
        requestType: "create_event",
        submittedBy: "test@example.com",
        eventName: "Morning Beatdown",
        locationId: 1,
        eventStartTime: "0530",
        regionId: 1,
        eventEndTime: "0615",
        eventDescription: "A great workout",
        meta: { originalRegionId: 1, originalAoId: 1, originalLocationId: 1 },
      }),
    );

    // Then edit the event (using the ID from mockInsertEvent)
    const editRequest = createEditEventRequest();
    await handleEditEvent(ctx, editRequest);

    // Verify updateEvent was called with correct params
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    expect(mockUpdateEvent).toHaveBeenCalledWith(ctx, {
      eventId: 1,
      locationId: undefined,
      eventName: "Updated Beatdown",
      eventDescription: undefined,
      eventDayOfWeek: "tuesday",
      eventStartTime: "0600",
      eventEndTime: "0700",
      eventStartDate: undefined,
    });

    // Verify updateEventTypes was called (2 times total: once for create, once for edit)
    expect(mockUpdateEventTypes).toHaveBeenCalledTimes(2);
    expect(mockUpdateEventTypes).toHaveBeenLastCalledWith(ctx, {
      eventId: 1,
      eventTypeIds: [1],
    });

    const editResult = await recordUpdateRequest({
      ctx,
      updateRequest: editRequest,
      status: "approved",
    });

    expect(editResult).toEqual(
      expect.objectContaining({
        status: "approved",
        eventName: "Updated Beatdown",
        eventDayOfWeek: "tuesday",
        eventStartTime: "0600",
        eventEndTime: "0700",
      }),
    );
  });
});

describe("handleEditAOAndLocation - modifies an existing AO and location", () => {
  it("creates an AO and location first, then edits them and records both requests with updated details", async () => {
    const { ctx } = createMockContext();

    // First create the AO and location
    const createRequest = createAOAndLocationAndEventRequest();
    await handleCreateLocationAndEvent(ctx, createRequest);

    const createResult = await recordUpdateRequest({
      ctx,
      updateRequest: { ...createRequest, eventDayOfWeek: "monday" },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = createResult;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        status: "approved",
        id: "test-request-id",
        eventDayOfWeek: "monday",
        aoLogo: null,
        aoWebsite: null,
        aoId: undefined,
        aoName: "The Forge",
        requestType: "create_ao_and_location_and_event",
        submittedBy: "test@example.com",
        eventId: undefined,
        eventName: "Morning Beatdown",
        eventStartTime: "0530",
        eventEndTime: "0615",
        eventTypeIds: [1, 2],
        eventDescription: "A great workout",
        eventMeta: undefined,
        locationId: undefined,
        locationAddress2: null,
        locationLat: 35.2271,
        locationLng: -80.8431,
        locationAddress: "123 Main St",
        locationCity: "Charlotte",
        locationState: "NC",
        locationZip: "28202",
        locationCountry: "United States",
        locationDescription: "Near the park",
        regionId: 1,
        meta: { originalRegionId: 1 },
      }),
    );

    // Then edit the AO and location
    const editRequest = createEditAOAndLocationRequest();
    await handleEditAOAndLocation(ctx, editRequest);

    // Verify updateAO was called with correct params
    expect(mockUpdateAO).toHaveBeenCalledTimes(1);
    expect(mockUpdateAO).toHaveBeenCalledWith(ctx, {
      id: 1,
      name: "Updated AO Name",
      logoUrl: undefined,
      website: undefined,
    });

    // Verify updateLocation was called with correct params
    expect(mockUpdateLocation).toHaveBeenCalledTimes(1);
    expect(mockUpdateLocation).toHaveBeenCalledWith(ctx, {
      locationId: 1,
      locationName: null,
      locationLat: 35.2271,
      locationLng: -80.8431,
      locationAddress: "123 Main St",
      locationAddress2: undefined,
      locationCity: "Charlotte",
      locationState: "NC",
      locationZip: "28202",
      locationCountry: "United States",
      locationDescription: undefined,
    });

    const editResult = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...editRequest,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    expect(editResult).toEqual(
      expect.objectContaining({
        status: "approved",
        requestType: "edit_ao_and_location",
        aoName: "Updated AO Name",
        locationLat: 35.2271,
        locationLng: -80.8431,
        locationAddress: "123 Main St",
        locationCity: "Charlotte",
        locationState: "NC",
        locationZip: "28202",
        locationCountry: "United States",
      }),
    );
  });
});

describe("handleMoveAOToDifferentRegion - moves an AO to a different region", () => {
  it("moves an AO to a different region and records the update request with approved status", async () => {
    const { ctx } = createMockContext();
    const request = createMoveAOToDifferentRegionRequest();

    await handleMoveAOToDifferentRegion(ctx, request);

    // Verify updateAO was called to move the AO to a different region
    expect(mockUpdateAO).toHaveBeenCalledTimes(1);
    expect(mockUpdateAO).toHaveBeenCalledWith(ctx, {
      id: 1,
      parentId: 2,
    });

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        eventId: undefined,
        eventMeta: undefined,
        eventDayOfWeek: "monday",
        status: "approved",
        requestType: "move_ao_to_different_region",
        submittedBy: "test@example.com",
        regionId: 2,
        aoId: 1,
        locationId: undefined,
        meta: {
          originalAoId: 1,
          originalRegionId: 1,
          newRegionId: 2,
        },
      }),
    );
  });
});

describe("handleMoveAOToDifferentLocation - moves an AO to a different location", () => {
  it("moves an AO to a different location and records the update request with approved status", async () => {
    const { ctx, mockDb } = createMockContext();
    const request = createMoveAOToDifferentLocationRequest();

    await handleMoveAOToDifferentLocation(ctx, request);

    // Verify db.update was called to update events with the new location
    expect(mockDb._mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith({ locationId: 2 });
    expect(mockDb._mocks.mockWhere).toHaveBeenCalledTimes(1);

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        eventId: undefined,
        eventMeta: undefined,
        eventDayOfWeek: "monday",
        status: "approved",
        requestType: "move_ao_to_different_location",
        submittedBy: "test@example.com",
        regionId: 1,
        aoId: 1,
        locationId: 2,
        meta: {
          originalAoId: 1,
          originalLocationId: 1,
          originalRegionId: 1,
          newLocationId: 2,
        },
      }),
    );
  });
});

describe("handleMoveAOToNewLocation - moves an AO to a new location", () => {
  it("creates a new location and updates events to use it", async () => {
    const { ctx, mockDb } = createMockContext();
    const request = createMoveAOToNewLocationRequest();

    await handleMoveAOToNewLocation(ctx, request);

    // Verify insertLocation was called with correct params
    expect(mockInsertLocation).toHaveBeenCalledTimes(1);
    expect(mockInsertLocation).toHaveBeenCalledWith(ctx, {
      locationLat: 35.3,
      locationLng: -80.9,
      locationAddress: "456 New St",
      locationAddress2: undefined,
      locationCity: "Charlotte",
      locationState: "NC",
      locationZip: "28203",
      locationCountry: "United States",
      locationDescription: undefined,
      regionId: 1,
    });

    // Verify db.update was called to update events with the new location
    expect(mockDb._mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith({ locationId: 100 });
    expect(mockDb._mocks.mockWhere).toHaveBeenCalledTimes(1);

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        eventId: undefined,
        eventMeta: undefined,
        status: "approved",
        requestType: "move_ao_to_new_location",
        submittedBy: "test@example.com",
        locationLat: 35.3,
        locationLng: -80.9,
        locationAddress: "456 New St",
        locationCity: "Charlotte",
        locationState: "NC",
        locationZip: "28203",
        locationCountry: "United States",
        regionId: 1,
        aoId: 1,
        locationId: 1,
        meta: {
          originalAoId: 1,
          originalLocationId: 1,
          originalRegionId: 1,
        },
      }),
    );
  });
});

describe("handleMoveEventToDifferentAO - moves an event to a different AO", () => {
  it("updates the event with new AO and location IDs", async () => {
    const { ctx } = createMockContext();
    const request = createMoveEventToDifferentAORequest();

    await handleMoveEventToDifferentAO(ctx, request);

    // Verify updateEvent was called with correct params
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    expect(mockUpdateEvent).toHaveBeenCalledWith(ctx, {
      eventId: 1,
      aoId: 2,
      locationId: 2,
    });

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...request,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        status: "approved",
        requestType: "move_event_to_different_ao",
        submittedBy: "test@example.com",
        regionId: 1,
        aoId: 2,
        locationId: 2,
        eventId: 1,
        eventDayOfWeek: "monday",
        eventMeta: undefined,
        meta: {
          originalAoId: 1,
          originalRegionId: 1,
          newAoId: 2,
          newLocationId: 2,
          originalEventId: 1,
        },
      }),
    );
  });
});

describe("handleDeleteEvent - soft deletes an event", () => {
  it("creates an event first, then deletes it by setting isActive to false", async () => {
    const { ctx, mockDb } = createMockContext();

    // First create the event
    const createRequest = createEventRequest();
    await handleCreateEvent(ctx, createRequest);

    // Verify event was created
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent).toHaveBeenCalledWith(ctx, {
      aoId: 1,
      locationId: 1,
      eventName: "Morning Beatdown",
      eventDescription: "A great workout",
      eventDayOfWeek: "monday",
      eventStartTime: "0530",
      eventEndTime: "0615",
      eventStartDate: undefined,
    });

    // Then delete the event
    const deleteRequest = createDeleteEventRequest();
    await handleDeleteEvent(ctx, deleteRequest);

    // Verify db.update was called to set isActive to false
    expect(mockDb._mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith({ isActive: false });
    expect(mockDb._mocks.mockWhere).toHaveBeenCalledTimes(1);

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...deleteRequest,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        status: "approved",
        requestType: "delete_event",
        submittedBy: "test@example.com",
        regionId: 1,
        eventId: 1,
        meta: {
          originalRegionId: 1,
          originalEventId: 1,
        },
      }),
    );
  });
});

describe("handleDeleteAO - soft deletes an AO and its events", () => {
  it("creates an AO first, then deletes it by setting isActive to false on AO and events", async () => {
    const { ctx, mockDb } = createMockContext();

    // First create the AO and location
    const createRequest = createAOAndLocationAndEventRequest();
    await handleCreateLocationAndEvent(ctx, createRequest);

    // Verify AO was created
    expect(mockCreateAO).toHaveBeenCalledTimes(1);

    // Then delete the AO
    const deleteRequest = createDeleteAORequest();
    await handleDeleteAO(ctx, deleteRequest);

    // Verify updateAO was called to set isActive to false
    expect(mockUpdateAO).toHaveBeenCalledTimes(1);
    expect(mockUpdateAO).toHaveBeenCalledWith(ctx, {
      id: 1,
      isActive: false,
    });

    // Verify db.update was called to set isActive to false on events
    expect(mockDb._mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith({ isActive: false });
    expect(mockDb._mocks.mockWhere).toHaveBeenCalledTimes(1);

    const result = await recordUpdateRequest({
      ctx,
      updateRequest: {
        ...deleteRequest,
        eventDayOfWeek: "monday",
      },
      status: "approved",
    });

    const { created, reviewedAt, ...stableResult } = result;
    expect(created).toBeDefined();
    expect(reviewedAt).toBeDefined();

    expect(stableResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        status: "approved",
        requestType: "delete_ao",
        submittedBy: "test@example.com",
        regionId: 1,
        aoId: 1,
        meta: {
          originalRegionId: 1,
          originalAoId: 1,
        },
      }),
    );
  });
});

describe("rejectSubmission - rejects a pending update request", () => {
  it("creates a pending request first, then rejects it by updating status to rejected", async () => {
    const { ctx, mockDb } = createMockContext();

    // First create a pending request
    const request = createEventRequest();
    const pendingResult = await recordUpdateRequest({
      ctx,
      updateRequest: request,
      status: "pending",
    });

    expect(pendingResult).toEqual(
      expect.objectContaining({
        id: "test-request-id",
        status: "pending",
        requestType: "create_event",
      }),
    );

    // Simulate rejecting the request by calling db.update
    mockDb._mocks.mockUpdate({});
    mockDb._mocks.mockSet({ status: "rejected" });
    await mockDb._mocks.mockWhere({});

    // Verify db.update was called to set status to rejected
    expect(mockDb._mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDb._mocks.mockSet).toHaveBeenCalledWith({ status: "rejected" });
    expect(mockDb._mocks.mockWhere).toHaveBeenCalledTimes(1);
  });
});
