import { describe, it, expect } from "vitest";
import { formatPhoneNumber, stripPhoneFormatting } from "./phone";

describe("formatPhoneNumber", () => {
  it("returns empty string for empty input", () => {
    expect(formatPhoneNumber("")).toBe("");
  });

  it("returns empty string for non-digit input", () => {
    expect(formatPhoneNumber("abcdef")).toBe("");
  });

  it("wraps a single digit in parenthesis", () => {
    expect(formatPhoneNumber("5")).toBe("(5");
  });

  it("formats two digits with opening parenthesis", () => {
    expect(formatPhoneNumber("55")).toBe("(55");
  });

  it("formats three digits with opening parenthesis", () => {
    expect(formatPhoneNumber("555")).toBe("(555");
  });

  it("formats four digits with area code and space", () => {
    expect(formatPhoneNumber("5551")).toBe("(555) 1");
  });

  it("formats six digits with area code and prefix", () => {
    expect(formatPhoneNumber("555123")).toBe("(555) 123");
  });

  it("formats seven digits with area code, prefix, and dash", () => {
    expect(formatPhoneNumber("5551234")).toBe("(555) 123-4");
  });

  it("formats a full 10-digit number", () => {
    expect(formatPhoneNumber("5551234567")).toBe("(555) 123-4567");
  });

  it("truncates input beyond 10 digits", () => {
    expect(formatPhoneNumber("55512345678")).toBe("(555) 123-4567");
    expect(formatPhoneNumber("5551234567890")).toBe("(555) 123-4567");
  });

  it("strips non-digit characters from mixed input", () => {
    expect(formatPhoneNumber("abc555def1234567")).toBe("(555) 123-4567");
  });

  it("re-formats an already formatted number", () => {
    expect(formatPhoneNumber("(555) 123-4567")).toBe("(555) 123-4567");
  });

  it("handles partial formatted input", () => {
    expect(formatPhoneNumber("(555) ")).toBe("(555");
    expect(formatPhoneNumber("(555) 1")).toBe("(555) 1");
  });

  it("handles whitespace-only input", () => {
    expect(formatPhoneNumber("   ")).toBe("");
  });

  it("handles special characters mixed with digits", () => {
    expect(formatPhoneNumber("+1-555-123-4567")).toBe("(155) 512-3456");
  });
});

describe("stripPhoneFormatting", () => {
  it("returns empty string for empty input", () => {
    expect(stripPhoneFormatting("")).toBe("");
  });

  it("strips parentheses, spaces, and dashes from formatted number", () => {
    expect(stripPhoneFormatting("(555) 123-4567")).toBe("5551234567");
  });

  it("returns digits unchanged if already stripped", () => {
    expect(stripPhoneFormatting("5551234567")).toBe("5551234567");
  });

  it("strips all non-digit characters", () => {
    expect(stripPhoneFormatting("+1 (555) 123-4567")).toBe("15551234567");
  });

  it("returns empty string for non-digit input", () => {
    expect(stripPhoneFormatting("abcdef")).toBe("");
  });

  it("handles partial formatting", () => {
    expect(stripPhoneFormatting("(555) ")).toBe("555");
  });
});
