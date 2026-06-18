import { describe, expect, it } from "vitest";

import { CreateAOAndLocationAndEventSchema } from "@acme/validators/request-schemas";

import {
  aoFields,
  base,
  eventFields,
  expectInvalidAt,
  expectValid,
  locationFields,
} from "./request-schema-fixtures";

const valid = {
  ...base,
  ...eventFields,
  ...aoFields,
  ...locationFields,
  requestType: "create_ao_and_location_and_event" as const,
};

describe("CreateAOAndLocationAndEventSchema – valid submissions", () => {
  it("accepts a complete create request", () =>
    expectValid(CreateAOAndLocationAndEventSchema, valid));

  it("preserves submitted field values after parsing", () => {
    const result = CreateAOAndLocationAndEventSchema.parse(valid);
    expect(result).toMatchObject({
      requestType: "create_ao_and_location_and_event",
      eventName: "Morning Bootcamp",
      eventDayOfWeek: "monday",
      aoName: "Test AO",
      locationAddress: "123 Main Street",
      originalRegionId: 5,
      submittedBy: "tester@example.com",
    });
  });

  it("defaults badImage, isReview and locationCountry when omitted", () => {
    const { locationCountry: _c, ...withoutCountry } = valid;
    const result = CreateAOAndLocationAndEventSchema.parse(withoutCountry);
    expect(result.badImage).toBe(false);
    expect(result.isReview).toBe(false);
    expect(result.locationCountry).toBe("United States");
  });

  it("treats empty-string aoLogo/aoWebsite as omitted (preprocess)", () => {
    const result = CreateAOAndLocationAndEventSchema.safeParse({
      ...valid,
      aoLogo: "",
      aoWebsite: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aoLogo).toBeUndefined();
      expect(result.data.aoWebsite).toBeUndefined();
    }
  });

  it("accepts null aoLogo and aoWebsite", () =>
    expectValid(CreateAOAndLocationAndEventSchema, {
      ...valid,
      aoLogo: null,
      aoWebsite: null,
    }));

  it("accepts optional event/location descriptors when present", () =>
    expectValid(CreateAOAndLocationAndEventSchema, {
      ...valid,
      eventDescription: "Meet at the flag",
      eventStartDate: "2026-07-01",
      locationAddress2: "Suite 200",
      locationDescription: "Back parking lot",
    }));

  it("accepts a review submission flagged with isReview", () =>
    expectValid(CreateAOAndLocationAndEventSchema, {
      ...valid,
      isReview: true,
    }));
});

describe("CreateAOAndLocationAndEventSchema – invalid event fields", () => {
  it("rejects an event name shorter than 3 characters", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, eventName: "AB" },
      "eventName",
    ));

  it("rejects an empty eventTypeIds list", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, eventTypeIds: [] },
      "eventTypeIds",
    ));

  it("rejects a malformed start time", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, eventStartTime: "5:30" },
      "eventStartTime",
    ));

  it("rejects a malformed end time", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, eventEndTime: "615" },
      "eventEndTime",
    ));

  it("rejects an unknown day of week", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, eventDayOfWeek: "funday" },
      "eventDayOfWeek",
    ));
});

describe("CreateAOAndLocationAndEventSchema – invalid AO fields", () => {
  it("rejects an AO name shorter than 2 characters", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, aoName: "A" },
      "aoName",
    ));

  it("rejects a non-URL aoLogo", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, aoLogo: "not-a-url" },
      "aoLogo",
    ));

  it("rejects a non-URL aoWebsite", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, aoWebsite: "not-a-url" },
      "aoWebsite",
    ));
});

describe("CreateAOAndLocationAndEventSchema – invalid location fields", () => {
  it("rejects a missing location address", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, locationAddress: "" },
      "locationAddress",
    ));

  it("rejects a city shorter than 2 characters", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, locationCity: "C" },
      "locationCity",
    ));

  it("rejects a ZIP shorter than 3 characters", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, locationZip: "12" },
      "locationZip",
    ));

  it("rejects a non-numeric latitude", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, locationLat: "35.5" },
      "locationLat",
    ));
});

describe("CreateAOAndLocationAndEventSchema – invalid base fields", () => {
  it("rejects a non-numeric originalRegionId", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, originalRegionId: "5" },
      "originalRegionId",
    ));

  it("rejects a missing originalRegionId", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, originalRegionId: undefined },
      "originalRegionId",
    ));

  it("rejects an invalid submittedBy email", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, submittedBy: "not-an-email" },
      "submittedBy",
    ));

  it("rejects a mismatched requestType literal", () =>
    expectInvalidAt(
      CreateAOAndLocationAndEventSchema,
      { ...valid, requestType: "create_event" },
      "requestType",
    ));
});
