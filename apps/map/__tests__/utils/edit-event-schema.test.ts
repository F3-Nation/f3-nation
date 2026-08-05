import { describe, it } from "vitest";

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
});
