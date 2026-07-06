import { describe, expect, it } from "vitest";

import { EditAOAndLocationSchema } from "@acme/validators/request-schemas";

import {
  aoFields,
  base,
  expectInvalidAt,
  expectValid,
  locationFields,
} from "./request-schema-fixtures";

// A fully-populated, correct edit_ao_and_location submission – the shape the
// EditAoAndLocationModal hands to zodResolver when the user hits "Update".
const valid = {
  ...base,
  ...aoFields,
  ...locationFields,
  requestType: "edit_ao_and_location" as const,
  originalAoId: 30,
  originalLocationId: 10,
  currentValues: {
    aoName: "Old AO",
    locationAddress: "1 Old Road",
  },
};

describe("EditAOAndLocationSchema – valid submission", () => {
  it("accepts a correctly-filled submission", () =>
    expectValid(EditAOAndLocationSchema, valid));

  it("preserves the submitted field values after parsing", () => {
    const result = EditAOAndLocationSchema.parse(valid);
    expect(result).toMatchObject({
      requestType: "edit_ao_and_location",
      originalAoId: 30,
      originalLocationId: 10,
      originalRegionId: 5,
      aoName: "Test AO",
      locationAddress: "123 Main Street",
      submittedBy: "tester@example.com",
    });
  });

  it("treats empty-string aoLogo/aoWebsite as omitted (preprocess)", () => {
    const result = EditAOAndLocationSchema.safeParse({
      ...valid,
      aoLogo: "",
      aoWebsite: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aoLogo).toBeUndefined();
      expect(result.data.aoWebsite).toBeUndefined();
    }
  });

  it("defaults badImage and isReview when omitted", () => {
    const result = EditAOAndLocationSchema.parse(valid);
    expect(result.badImage).toBe(false);
    expect(result.isReview).toBe(false);
  });

  it("allows optional AO/location fields to be absent", () =>
    expectValid(EditAOAndLocationSchema, {
      ...base,
      requestType: "edit_ao_and_location" as const,
      originalAoId: 30,
      originalLocationId: 10,
      currentValues: {},
    }));
});

describe("EditAOAndLocationSchema – invalid submissions", () => {
  it("rejects an aoName shorter than 2 characters", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, aoName: "A" },
      "aoName",
    ));

  it("rejects a non-URL aoLogo", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, aoLogo: "not-a-valid-url" },
      "aoLogo",
    ));

  it("rejects a non-URL aoWebsite", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, aoWebsite: "not-a-valid-url" },
      "aoWebsite",
    ));

  it("rejects an address shorter than 5 characters", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, locationAddress: "123" },
      "locationAddress",
    ));

  it("rejects a non-positive originalAoId", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, originalAoId: 0 },
      "originalAoId",
    ));

  it("rejects a non-positive originalLocationId", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, originalLocationId: -1 },
      "originalLocationId",
    ));

  it("rejects a missing originalRegionId", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, originalRegionId: undefined },
      "originalRegionId",
    ));

  it("rejects an invalid submittedBy email", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, submittedBy: "not-an-email" },
      "submittedBy",
    ));

  it("rejects a mismatched requestType literal", () =>
    expectInvalidAt(
      EditAOAndLocationSchema,
      { ...valid, requestType: "edit_event" },
      "requestType",
    ));
});
