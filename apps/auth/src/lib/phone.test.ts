import { describe, it, expect } from "vitest";
import {
  detectPhoneCountry,
  formatPhoneNumber,
  normalizePhoneNumber,
} from "./phone";

describe("formatPhoneNumber", () => {
  it("returns empty string for empty input", () => {
    expect(formatPhoneNumber("", "US")).toBe("");
  });

  it("returns empty string for non-digit input", () => {
    expect(formatPhoneNumber("abcdef", "US")).toBe("");
  });

  it("formats a US number progressively", () => {
    expect(formatPhoneNumber("5", "US")).toBe("5");
    expect(formatPhoneNumber("5551", "US")).toBe("(555) 1");
    expect(formatPhoneNumber("5551234567", "US")).toBe("(555) 123-4567");
  });

  it("formats a UK local number without truncating it", () => {
    expect(formatPhoneNumber("01772667002", "GB")).toBe("01772 667002");
  });

  it("formats international numbers when they include a calling code", () => {
    expect(formatPhoneNumber("+441772667002", "US")).toBe("+44 1772 667002");
  });

  it("strips unsupported characters before formatting", () => {
    expect(formatPhoneNumber("abc+44 1772-667002", "GB")).toBe(
      "+44 1772 667002",
    );
  });

  it("re-formats already formatted input idempotently", () => {
    expect(formatPhoneNumber("(555) 123-4567", "US")).toBe("(555) 123-4567");
    expect(formatPhoneNumber("01772 667002", "GB")).toBe("01772 667002");
  });
});

describe("normalizePhoneNumber", () => {
  it("returns empty string for empty input", () => {
    expect(normalizePhoneNumber("", "US")).toBe("");
  });

  it("normalizes a US number to E.164", () => {
    expect(normalizePhoneNumber("(555) 123-4567", "US")).toBe("+15551234567");
  });

  it("normalizes a UK local number to E.164", () => {
    expect(normalizePhoneNumber("01772 667002", "GB")).toBe("+441772667002");
  });

  it("normalizes an international number without a default country", () => {
    expect(normalizePhoneNumber("+44 1772 667002", "US")).toBe("+441772667002");
  });

  it("falls back to parsed incomplete digits when the number is incomplete", () => {
    expect(normalizePhoneNumber("(555) 12", "US")).toBe("55512");
  });
});

describe("detectPhoneCountry", () => {
  it("uses the locale region when supported", () => {
    expect(detectPhoneCountry("en-GB")).toBe("GB");
    expect(detectPhoneCountry("en-AU")).toBe("AU");
  });

  it("falls back to US when the locale is missing or unsupported", () => {
    expect(detectPhoneCountry()).toBe("US");
    expect(detectPhoneCountry("zz-ZZ")).toBe("US");
  });
});
