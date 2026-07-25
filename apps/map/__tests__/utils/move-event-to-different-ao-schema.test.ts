import { describe, it } from "vitest";

import { MoveEventToDifferentAOSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "move_event_to_different_ao" as const,
  originalEventId: 20,
  originalAoId: 30,
  newAoId: 31,
};

describe("MoveEventToDifferentAOSchema", () => {
  it("accepts a move-event-to-different-ao request", () =>
    expectValid(MoveEventToDifferentAOSchema, valid));

  it("accepts optional new* targets when positive", () =>
    expectValid(MoveEventToDifferentAOSchema, {
      ...valid,
      newAoId: 31,
      newLocationId: 11,
    }));

  it("rejects a non-positive originalEventId", () =>
    expectInvalidAt(
      MoveEventToDifferentAOSchema,
      { ...valid, originalEventId: 0 },
      "originalEventId",
    ));

  it("rejects a non-positive newLocationId when provided", () =>
    expectInvalidAt(
      MoveEventToDifferentAOSchema,
      { ...valid, newLocationId: 0 },
      "newLocationId",
    ));
});
