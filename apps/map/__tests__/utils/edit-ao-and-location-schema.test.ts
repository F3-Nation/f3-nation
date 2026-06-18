import { describe, expect, it } from "vitest";

import type { EditAOAndLocationType } from "@acme/validators/request-schemas";
import { EditAOAndLocationSchema } from "@acme/validators/request-schemas";

// A fully-populated, correct edit_ao_and_location submission – the shape the
// EditAoAndLocationModal hands to zodResolver when the user hits "Update".
const validSubmission: EditAOAndLocationType = {
  requestType: "edit_ao_and_location",
  id: "11111111-1111-1111-1111-111111111111",
  isReview: false,
  badImage: false,
  submittedBy: "tester@example.com",

  originalRegionId: 5,
  originalAoId: 30,
  originalLocationId: 10,

  aoName: "Test AO",
  aoLogo: "https://example.com/logo.png",
  aoWebsite: "https://example.com",

  locationLat: 35.5,
  locationLng: -80.5,
  locationAddress: "123 Main Street",
  locationAddress2: "Suite 4",
  locationCity: "Charlotte",
  locationState: "NC",
  locationZip: "28202",
  locationCountry: "United States",
  locationDescription: "Back parking lot",

  currentValues: {
    aoName: "Old AO",
    locationAddress: "1 Old Road",
  },
};

describe("EditAOAndLocationSchema – valid submission", () => {
  it("accepts a correctly-filled submission", () => {
    const result = EditAOAndLocationSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it("preserves the submitted field values after parsing", () => {
    const result = EditAOAndLocationSchema.parse(validSubmission);
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
      ...validSubmission,
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
    const { badImage: _b, isReview: _r, ...rest } = validSubmission;
    const result = EditAOAndLocationSchema.parse(rest);
    expect(result.badImage).toBe(false);
    expect(result.isReview).toBe(false);
  });

  it("allows optional AO/location fields to be absent", () => {
    const minimal = {
      requestType: "edit_ao_and_location" as const,
      id: validSubmission.id,
      submittedBy: validSubmission.submittedBy,
      originalRegionId: 5,
      originalAoId: 30,
      originalLocationId: 10,
      currentValues: {},
    };
    expect(EditAOAndLocationSchema.safeParse(minimal).success).toBe(true);
  });
});

describe("EditAOAndLocationSchema – invalid submissions", () => {
  const invalidField = (
    label: string,
    overrides: Record<string, unknown>,
    path: string,
  ) => {
    it(`rejects ${label}`, () => {
      const result = EditAOAndLocationSchema.safeParse({
        ...validSubmission,
        ...overrides,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes(path))).toBe(
          true,
        );
      }
    });
  };

  invalidField(
    "an aoName shorter than 2 characters",
    { aoName: "A" },
    "aoName",
  );
  invalidField("a non-URL aoLogo", { aoLogo: "not-a-valid-url" }, "aoLogo");
  invalidField(
    "a non-URL aoWebsite",
    { aoWebsite: "not-a-valid-url" },
    "aoWebsite",
  );
  invalidField(
    "an address shorter than 5 characters",
    { locationAddress: "123" },
    "locationAddress",
  );
  invalidField(
    "a non-positive originalAoId",
    { originalAoId: 0 },
    "originalAoId",
  );
  invalidField(
    "a non-positive originalLocationId",
    { originalLocationId: -1 },
    "originalLocationId",
  );
  invalidField(
    "a missing originalRegionId",
    { originalRegionId: undefined },
    "originalRegionId",
  );
  invalidField(
    "an invalid submittedBy email",
    { submittedBy: "not-an-email" },
    "submittedBy",
  );
  invalidField(
    "a mismatched requestType literal",
    { requestType: "edit_event" },
    "requestType",
  );
});
