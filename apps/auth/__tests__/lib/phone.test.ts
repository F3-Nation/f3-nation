import { describe, it, expect } from "vitest";
import { detectPhoneCountry } from "../../src/lib/phone";

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
