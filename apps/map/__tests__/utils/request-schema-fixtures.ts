import { expect } from "vitest";

// Shared, valid field bundles + assertion helpers used by the per-schema
// request validation tests. These mirror the values the map's request modals
// submit on a happy path.
export const base = {
  id: "11111111-1111-4111-8111-111111111111",
  submittedBy: "tester@example.com",
  originalRegionId: 5,
};

export const eventFields = {
  eventName: "Morning Bootcamp",
  eventDayOfWeek: "monday" as const,
  eventStartTime: "0530",
  eventEndTime: "0615",
  eventTypeIds: [1],
};

export const aoFields = {
  aoName: "Test AO",
  aoLogo: "https://example.com/logo.png",
  aoWebsite: "https://example.com",
};

export const locationFields = {
  locationLat: 35.5,
  locationLng: -80.5,
  locationAddress: "123 Main Street",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28202",
  locationCountry: "United States",
};

// Asserts a payload parses cleanly.
export const expectValid = (
  schema: { safeParse: (v: unknown) => { success: boolean } },
  payload: unknown,
) => {
  const result = schema.safeParse(payload);
  expect(result.success).toBe(true);
};

// Asserts a payload fails and the error mentions `path`.
export const expectInvalidAt = (
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: { path: PropertyKey[] }[] };
    };
  },
  payload: unknown,
  path: string,
) => {
  const result = schema.safeParse(payload);
  expect(result.success).toBe(false);
  if (!result.success && result.error) {
    expect(result.error.issues.some((i) => i.path.includes(path))).toBe(true);
  }
};
