import { describe, expect, it } from "vitest";

import { MoveAOToNewLocationSchema } from "@acme/validators/request-schemas";

import {
  base,
  expectInvalidAt,
  expectValid,
  locationFields,
} from "./request-schema-fixtures";

const valid = {
  ...base,
  ...locationFields,
  requestType: "move_ao_to_new_location" as const,
  originalAoId: 30,
  originalLocationId: 10,
  currentValues: { locationAddress: "1 Old Road" },
};

describe("MoveAOToNewLocationSchema", () => {
  it("keeps prior values that break today's rules", () => {
    const currentValues = { locationAddress: "123", locationZip: "1" };
    const result = MoveAOToNewLocationSchema.parse({ ...valid, currentValues });
    expect(result.currentValues).toEqual(currentValues);
  });

  it("rejects a prior value of the wrong type", () =>
    expectInvalidAt(
      MoveAOToNewLocationSchema,
      { ...valid, currentValues: { locationLat: "35.5" } },
      "currentValues",
    ));

  it("accepts a move-to-new-location request", () =>
    expectValid(MoveAOToNewLocationSchema, valid));

  it("requires the full location fields", () =>
    expectInvalidAt(
      MoveAOToNewLocationSchema,
      { ...valid, locationLat: undefined },
      "locationLat",
    ));

  it("rejects a non-positive originalLocationId", () =>
    expectInvalidAt(
      MoveAOToNewLocationSchema,
      { ...valid, originalLocationId: 0 },
      "originalLocationId",
    ));
});
