import { describe, it } from "vitest";

import { DeleteEventSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "delete_event" as const,
  originalEventId: 20,
};

describe("DeleteEventSchema", () => {
  it("accepts a delete-event request", () =>
    expectValid(DeleteEventSchema, valid));

  it("rejects a non-positive originalEventId", () =>
    expectInvalidAt(
      DeleteEventSchema,
      { ...valid, originalEventId: 0 },
      "originalEventId",
    ));

  it("rejects a mismatched requestType", () =>
    expectInvalidAt(
      DeleteEventSchema,
      { ...valid, requestType: "delete_ao" },
      "requestType",
    ));
});
