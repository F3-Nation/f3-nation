import type {
  CreateAOAndLocationAndEventType,
  CreateEventType,
  DeleteAOType,
  DeleteEventType,
  EditAOAndLocationType,
  EditEventType,
  MoveAOToDifferentLocationType,
  MoveAoToDifferentRegionType,
  MoveAOToNewLocationType,
  MoveEventToDifferentAOType,
  MoveEventToNewAOType,
  MoveEventToNewLocationType,
} from "@acme/validators/request-schemas";

/**
 * Creates a valid CreateAOAndLocationAndEvent request for testing.
 */
export const createAOAndLocationAndEventRequest = (
  overrides: Partial<CreateAOAndLocationAndEventType> = {},
): CreateAOAndLocationAndEventType => ({
  id: "test-request-id",
  requestType: "create_ao_and_location_and_event",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  // Event fields
  eventName: "Morning Beatdown",
  eventDayOfWeek: "monday",
  eventStartTime: "0530",
  eventEndTime: "0615",
  eventTypeIds: [1, 2],
  eventDescription: "A great workout",
  // AO fields
  aoName: "The Forge",
  aoLogo: null,
  aoWebsite: null,
  // Location fields
  locationLat: 35.2271,
  locationLng: -80.8431,
  locationAddress: "123 Main St",
  locationAddress2: null,
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28202",
  locationCountry: "United States",
  locationDescription: "Near the park",
  ...overrides,
});

/**
 * Creates a valid CreateEvent request for testing.
 */
export const createEventRequest = (
  overrides: Partial<CreateEventType> = {},
): CreateEventType => ({
  id: "test-request-id",
  requestType: "create_event",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  originalLocationId: 1,
  eventName: "Morning Beatdown",
  eventDayOfWeek: "monday",
  eventStartTime: "0530",
  eventEndTime: "0615",
  eventTypeIds: [1],
  eventDescription: "A great workout",
  ...overrides,
});

/**
 * Creates a valid EditEvent request for testing.
 */
export const createEditEventRequest = (
  overrides: Partial<EditEventType> = {},
): EditEventType => ({
  id: "test-request-id",
  requestType: "edit_event",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalEventId: 1,
  eventName: "Updated Beatdown",
  eventDayOfWeek: "tuesday",
  eventStartTime: "0600",
  eventEndTime: "0700",
  eventTypeIds: [1],
  currentValues: {},
  ...overrides,
});

/**
 * Creates a valid EditAOAndLocation request for testing.
 */
export const createEditAOAndLocationRequest = (
  overrides: Partial<EditAOAndLocationType> = {},
): EditAOAndLocationType => ({
  id: "test-request-id",
  requestType: "edit_ao_and_location",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  originalLocationId: 1,
  aoName: "Updated AO Name",
  locationLat: 35.2271,
  locationLng: -80.8431,
  locationAddress: "123 Main St",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28202",
  locationCountry: "United States",
  currentValues: {},
  ...overrides,
});

/**
 * Creates a valid MoveAOToDifferentRegion request for testing.
 */
export const createMoveAOToDifferentRegionRequest = (
  overrides: Partial<MoveAoToDifferentRegionType> = {},
): MoveAoToDifferentRegionType => ({
  id: "test-request-id",
  requestType: "move_ao_to_different_region",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  newRegionId: 2,
  ...overrides,
});

/**
 * Creates a valid MoveAOToNewLocation request for testing.
 */
export const createMoveAOToNewLocationRequest = (
  overrides: Partial<MoveAOToNewLocationType> = {},
): MoveAOToNewLocationType => ({
  id: "test-request-id",
  requestType: "move_ao_to_new_location",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  originalLocationId: 1,
  locationLat: 35.3,
  locationLng: -80.9,
  locationAddress: "456 New St",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28203",
  locationCountry: "United States",
  currentValues: {},
  ...overrides,
});

/**
 * Creates a valid MoveAOToDifferentLocation request for testing.
 */
export const createMoveAOToDifferentLocationRequest = (
  overrides: Partial<MoveAOToDifferentLocationType> = {},
): MoveAOToDifferentLocationType => ({
  id: "test-request-id",
  requestType: "move_ao_to_different_location",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  originalLocationId: 1,
  newLocationId: 2,
  ...overrides,
});

/**
 * Creates a valid MoveEventToDifferentAO request for testing.
 */
export const createMoveEventToDifferentAORequest = (
  overrides: Partial<MoveEventToDifferentAOType> = {},
): MoveEventToDifferentAOType => ({
  id: "test-request-id",
  requestType: "move_event_to_different_ao",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalEventId: 1,
  originalAoId: 1,
  newAoId: 2,
  newLocationId: 2,
  ...overrides,
});

/**
 * Creates a valid MoveEventToNewAO request for testing.
 *
 * Defaults to a null `newLocationId` so the handler creates a fresh location
 * from the submitted address; override it to exercise the reuse path.
 */
export const createMoveEventToNewAORequest = (
  overrides: Partial<MoveEventToNewAOType> = {},
): MoveEventToNewAOType => ({
  id: "test-request-id",
  requestType: "move_event_to_new_ao",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalEventId: 1,
  originalAoId: 1,
  originalLocationId: 1,
  newLocationId: null,
  // Event fields (unchanged event carried along with the move)
  eventName: "Morning Beatdown",
  eventDayOfWeek: "monday",
  eventStartTime: "0530",
  eventEndTime: "0615",
  eventTypeIds: [1],
  eventDescription: "A great workout",
  // AO fields (the new AO to create)
  aoName: "New AO",
  aoLogo: null,
  aoWebsite: null,
  // Location fields (the new location to create)
  locationLat: 35.3,
  locationLng: -80.9,
  locationAddress: "789 New AO St",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28205",
  locationCountry: "United States",
  ...overrides,
});

/**
 * Creates a valid MoveEventToNewLocation request for testing.
 */
export const createMoveEventToNewLocationRequest = (
  overrides: Partial<MoveEventToNewLocationType> = {},
): MoveEventToNewLocationType => ({
  id: "test-request-id",
  requestType: "move_event_to_new_location",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalEventId: 1,
  originalLocationId: 1,
  locationLat: 35.3,
  locationLng: -80.9,
  locationAddress: "789 Event St",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28204",
  locationCountry: "United States",
  currentValues: {},
  ...overrides,
});

/**
 * Creates a valid DeleteEvent request for testing.
 */
export const createDeleteEventRequest = (
  overrides: Partial<DeleteEventType> = {},
): DeleteEventType => ({
  id: "test-request-id",
  requestType: "delete_event",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalEventId: 1,
  ...overrides,
});

/**
 * Creates a valid DeleteAO request for testing.
 */
export const createDeleteAORequest = (
  overrides: Partial<DeleteAOType> = {},
): DeleteAOType => ({
  id: "test-request-id",
  requestType: "delete_ao",
  submittedBy: "test@example.com",
  isReview: false,
  originalRegionId: 1,
  originalAoId: 1,
  ...overrides,
});
