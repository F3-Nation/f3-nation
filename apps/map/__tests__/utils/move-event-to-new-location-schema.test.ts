import { describe, it } from "vitest";

import { MoveEventToNewLocationSchema } from "@acme/validators/request-schemas";

import {
  base,
  expectInvalidAt,
  expectValid,
  locationFields,
} from "./request-schema-fixtures";

const valid = {
  ...base,
  ...locationFields,
  requestType: "move_event_to_new_location" as const,
  originalEventId: 20,
  originalLocationId: 10,
  currentValues: { locationAddress: "1 Old Road" },
};

describe("MoveEventToNewLocationSchema", () => {
  it("accepts a move-event-to-new-location request", () =>
    expectValid(MoveEventToNewLocationSchema, valid));

  it("rejects a non-positive originalEventId", () =>
    expectInvalidAt(
      MoveEventToNewLocationSchema,
      { ...valid, originalEventId: 0 },
      "originalEventId",
    ));

  it("requires a location address of at least 5 characters", () =>
    expectInvalidAt(
      MoveEventToNewLocationSchema,
      { ...valid, locationAddress: "123" },
      "locationAddress",
    ));
});
