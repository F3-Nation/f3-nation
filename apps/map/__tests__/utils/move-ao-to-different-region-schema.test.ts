import { describe, it } from "vitest";

import { MoveAOToDifferentRegionSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "move_ao_to_different_region" as const,
  newRegionId: 6,
  originalAoId: 30,
};

describe("MoveAOToDifferentRegionSchema", () => {
  it("accepts a move-to-region request", () =>
    expectValid(MoveAOToDifferentRegionSchema, valid));

  it("rejects a non-positive newRegionId", () =>
    expectInvalidAt(
      MoveAOToDifferentRegionSchema,
      { ...valid, newRegionId: 0 },
      "newRegionId",
    ));

  it("rejects a non-positive originalAoId", () =>
    expectInvalidAt(
      MoveAOToDifferentRegionSchema,
      { ...valid, originalAoId: -1 },
      "originalAoId",
    ));
});
