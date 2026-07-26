import { describe, it } from "vitest";

import { MoveEventToNewAOSchema } from "@acme/validators/request-schemas";

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
  requestType: "move_event_to_new_ao" as const,
  originalEventId: 20,
  originalAoId: 30,
  originalLocationId: 10,
  newLocationId: 11,
};

describe("MoveEventToNewAOSchema", () => {
  it("accepts a complete move-event-to-new-ao request", () =>
    expectValid(MoveEventToNewAOSchema, valid));

  it("allows newLocationId to be null", () =>
    expectValid(MoveEventToNewAOSchema, { ...valid, newLocationId: null }));

  it("rejects a non-positive originalLocationId", () =>
    expectInvalidAt(
      MoveEventToNewAOSchema,
      { ...valid, originalLocationId: 0 },
      "originalLocationId",
    ));

  it("rejects a missing AO name", () =>
    expectInvalidAt(
      MoveEventToNewAOSchema,
      { ...valid, aoName: "" },
      "aoName",
    ));
});
