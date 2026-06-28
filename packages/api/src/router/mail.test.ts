/**
 * Tests for the mail router input validation.
 *
 * Pure schema-level tests — no database or mail transport required. They guard
 * the narrowing of `supportedTemplateSchema` to the templates the sendTest and
 * preview handlers actually implement, preventing unsupported templates from
 * passing validation (which would let sendTest silently succeed without sending
 * and preview throw "Unknown template").
 */

import { describe, expect, it } from "vitest";

import { Templates } from "@acme/mail";

import { supportedTemplateSchema } from "./mail";

describe("mail router · supportedTemplateSchema", () => {
  it("accepts the implemented templates", () => {
    expect(
      supportedTemplateSchema.safeParse(Templates.feedbackForm).success,
    ).toBe(true);
    expect(
      supportedTemplateSchema.safeParse(Templates.mapChangeRequest).success,
    ).toBe(true);
  });

  it("rejects templates with no handler implementation", () => {
    expect(
      supportedTemplateSchema.safeParse(Templates.regionInABox).success,
    ).toBe(false);
  });

  it("rejects unknown template values", () => {
    expect(supportedTemplateSchema.safeParse("not-a-template").success).toBe(
      false,
    );
  });
});
