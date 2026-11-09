import { describe, expect, it } from "vitest";

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
  it("keeps prior values that break today's rules", () => {
    const currentValues = { locationAddress: "123", locationZip: "1" };
    const result = MoveEventToNewLocationSchema.parse({
      ...valid,
      currentValues,
    });
    expect(result.currentValues).toEqual(currentValues);
  });

  it("rejects a prior value of the wrong type", () =>
    expectInvalidAt(
      MoveEventToNewLocationSchema,
      { ...valid, currentValues: { locationLat: "35.5" } },
      "currentValues",
    ));

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
