import { describe, it } from "vitest";

import { MoveAOToDifferentLocationSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "move_ao_to_different_location" as const,
  originalAoId: 30,
  originalLocationId: 10,
  newLocationId: 11,
};

describe("MoveAOToDifferentLocationSchema", () => {
  it("accepts a move-to-different-location request", () =>
    expectValid(MoveAOToDifferentLocationSchema, valid));

  it("rejects a non-positive newLocationId", () =>
    expectInvalidAt(
      MoveAOToDifferentLocationSchema,
      { ...valid, newLocationId: 0 },
      "newLocationId",
    ));

  it("rejects a missing originalLocationId", () =>
    expectInvalidAt(
      MoveAOToDifferentLocationSchema,
      { ...valid, originalLocationId: undefined },
      "originalLocationId",
    ));
});
