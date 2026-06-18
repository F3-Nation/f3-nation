import { describe, it } from "vitest";

import { CreateEventSchema } from "@acme/validators/request-schemas";

import {
  base,
  eventFields,
  expectInvalidAt,
  expectValid,
} from "./request-schema-fixtures";

const valid = {
  ...base,
  ...eventFields,
  requestType: "create_event" as const,
  originalAoId: 30,
  originalLocationId: 10,
};

describe("CreateEventSchema", () => {
  it("accepts a complete create-event request", () =>
    expectValid(CreateEventSchema, valid));

  it("rejects a non-positive originalAoId", () =>
    expectInvalidAt(
      CreateEventSchema,
      { ...valid, originalAoId: 0 },
      "originalAoId",
    ));

  it("rejects a non-positive originalLocationId", () =>
    expectInvalidAt(
      CreateEventSchema,
      { ...valid, originalLocationId: -1 },
      "originalLocationId",
    ));

  it("rejects a missing day of week", () =>
    expectInvalidAt(
      CreateEventSchema,
      { ...valid, eventDayOfWeek: "funday" },
      "eventDayOfWeek",
    ));
});
