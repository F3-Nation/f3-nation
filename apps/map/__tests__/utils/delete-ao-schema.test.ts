import { describe, it } from "vitest";

import { DeleteAOSchema } from "@acme/validators/request-schemas";

import { base, expectInvalidAt, expectValid } from "./request-schema-fixtures";

const valid = {
  ...base,
  requestType: "delete_ao" as const,
  originalAoId: 30,
};

describe("DeleteAOSchema", () => {
  it("accepts a delete-ao request", () => expectValid(DeleteAOSchema, valid));

  it("rejects a non-positive originalAoId", () =>
    expectInvalidAt(
      DeleteAOSchema,
      { ...valid, originalAoId: 0 },
      "originalAoId",
    ));

  it("rejects a missing originalRegionId", () =>
    expectInvalidAt(
      DeleteAOSchema,
      { ...valid, originalRegionId: undefined },
      "originalRegionId",
    ));
});
