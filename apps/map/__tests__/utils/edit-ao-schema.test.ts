import { describe, expect, it } from "vitest";

import { EditAOSchema } from "@acme/validators/request-schemas";

import {
  aoFields,
  base,
  expectInvalidAt,
  expectValid,
} from "./request-schema-fixtures";

// A fully-populated edit_ao submission – the shape the EditAoModal hands to
// zodResolver when the user hits "Update AO". No location fields are involved.
const valid = {
  ...base,
  ...aoFields,
  requestType: "edit_ao" as const,
  originalAoId: 30,
  currentValues: {
    aoName: "Old AO",
  },
};

describe("EditAOSchema – valid submission", () => {
  it("accepts a correctly-filled submission", () =>
    expectValid(EditAOSchema, valid));

  it("preserves the submitted field values after parsing", () => {
    const result = EditAOSchema.parse(valid);
    expect(result).toMatchObject({
      requestType: "edit_ao",
      originalAoId: 30,
      originalRegionId: 5,
      aoName: "Test AO",
      submittedBy: "tester@example.com",
    });
  });

  it("treats empty-string aoLogo/aoWebsite as omitted (preprocess)", () => {
    const result = EditAOSchema.safeParse({
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

  it("allows optional AO fields to be absent", () =>
    expectValid(EditAOSchema, {
      ...base,
      requestType: "edit_ao" as const,
      originalAoId: 30,
      currentValues: {},
    }));
});

describe("EditAOSchema – invalid submissions", () => {
  it("rejects an aoName shorter than 2 characters", () =>
    expectInvalidAt(EditAOSchema, { ...valid, aoName: "A" }, "aoName"));

  it("rejects a non-URL aoLogo", () =>
    expectInvalidAt(
      EditAOSchema,
      { ...valid, aoLogo: "not-a-valid-url" },
      "aoLogo",
    ));

  it("rejects a non-positive originalAoId", () =>
    expectInvalidAt(
      EditAOSchema,
      { ...valid, originalAoId: 0 },
      "originalAoId",
    ));

  it("rejects a missing originalRegionId", () =>
    expectInvalidAt(
      EditAOSchema,
      { ...valid, originalRegionId: undefined },
      "originalRegionId",
    ));

  it("rejects a mismatched requestType literal", () =>
    expectInvalidAt(
      EditAOSchema,
      { ...valid, requestType: "edit_location" },
      "requestType",
    ));
});
