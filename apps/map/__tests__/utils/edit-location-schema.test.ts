import { describe, expect, it } from "vitest";

import { EditLocationSchema } from "@acme/validators/request-schemas";

import {
  base,
  expectInvalidAt,
  expectValid,
  locationFields,
} from "./request-schema-fixtures";

// A fully-populated edit_location submission – the shape the EditLocationModal
// hands to zodResolver when the user hits "Update Location". No AO fields are
// involved; the location row may be shared across multiple AOs.
const valid = {
  ...base,
  ...locationFields,
  requestType: "edit_location" as const,
  originalLocationId: 10,
  currentValues: {
    locationAddress: "1 Old Road",
  },
};

describe("EditLocationSchema – valid submission", () => {
  it("accepts a correctly-filled submission", () =>
    expectValid(EditLocationSchema, valid));

  it("preserves the submitted field values after parsing", () => {
    const result = EditLocationSchema.parse(valid);
    expect(result).toMatchObject({
      requestType: "edit_location",
      originalLocationId: 10,
      originalRegionId: 5,
      locationAddress: "123 Main Street",
      submittedBy: "tester@example.com",
    });
  });

  it("allows optional location fields to be absent", () =>
    expectValid(EditLocationSchema, {
      ...base,
      requestType: "edit_location" as const,
      originalLocationId: 10,
      currentValues: {},
    }));
});

describe("EditLocationSchema – invalid submissions", () => {
  it("rejects an address shorter than 5 characters", () =>
    expectInvalidAt(
      EditLocationSchema,
      { ...valid, locationAddress: "123" },
      "locationAddress",
    ));

  it("rejects a non-positive originalLocationId", () =>
    expectInvalidAt(
      EditLocationSchema,
      { ...valid, originalLocationId: -1 },
      "originalLocationId",
    ));

  it("rejects a missing originalRegionId", () =>
    expectInvalidAt(
      EditLocationSchema,
      { ...valid, originalRegionId: undefined },
      "originalRegionId",
    ));

  it("rejects an invalid submittedBy email", () =>
    expectInvalidAt(
      EditLocationSchema,
      { ...valid, submittedBy: "not-an-email" },
      "submittedBy",
    ));

  it("rejects a mismatched requestType literal", () =>
    expectInvalidAt(
      EditLocationSchema,
      { ...valid, requestType: "edit_ao" },
      "requestType",
    ));
});
