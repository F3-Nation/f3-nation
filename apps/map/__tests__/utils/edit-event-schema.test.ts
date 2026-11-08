import { describe, expect, it } from "vitest";

import { EditEventSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "edit_event" as const,
  originalEventId: 20,
  currentValues: { eventName: "Old name" },
};

describe("EditEventSchema", () => {
  it("accepts an edit-event request with partial fields", () =>
    expectValid(EditEventSchema, valid));

  it("rejects a non-positive originalEventId", () =>
    expectInvalidAt(
      EditEventSchema,
      { ...valid, originalEventId: 0 },
      "originalEventId",
    ));

  it("rejects an event name shorter than 3 characters when provided", () =>
    expectInvalidAt(
      EditEventSchema,
      { ...valid, eventName: "AB" },
      "eventName",
    ));

  it("keeps prior values that break today's rules", () => {
    const currentValues = {
      eventName: "AB",
      eventStartTime: "530",
      eventEndTime: "6:15",
      eventDescription: null,
      eventTypeIds: [],
    };
    const result = EditEventSchema.parse({ ...valid, currentValues });
    expect(result.currentValues).toEqual(currentValues);
  });

  it("rejects a prior value of the wrong type", () =>
    expectInvalidAt(
      EditEventSchema,
      { ...valid, currentValues: { eventName: 42 } },
      "currentValues",
    ));
});
