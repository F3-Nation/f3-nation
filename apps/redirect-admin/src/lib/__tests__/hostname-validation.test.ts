import { describe, it, expect } from "vitest";

import { validateHostname } from "../hostname-validation";

describe("validateHostname", () => {
  it("accepts a plain fqdn", () => {
    expect(validateHostname("f3muletown.com")).toEqual({
      valid: true,
      normalized: "f3muletown.com",
    });
  });

  it("accepts a subdomain", () => {
    expect(validateHostname("stats.f3region.org")).toEqual({
      valid: true,
      normalized: "stats.f3region.org",
    });
  });

  it("lowercases and strips trailing dot", () => {
    expect(validateHostname("F3NATION.COM.")).toEqual({
      valid: true,
      normalized: "f3nation.com",
    });
  });

  it("rejects empty", () => {
    expect(validateHostname("")).toEqual({ valid: false, reason: "empty" });
    expect(validateHostname("   ")).toEqual({ valid: false, reason: "empty" });
  });

  it("rejects URLs with a scheme", () => {
    expect(validateHostname("https://f3muletown.com")).toEqual({
      valid: false,
      reason: "contains_scheme",
    });
  });

  it("rejects URLs with a path", () => {
    expect(validateHostname("f3muletown.com/path")).toEqual({
      valid: false,
      reason: "contains_path_or_query",
    });
  });

  it("rejects bare labels with no dots", () => {
    expect(validateHostname("localhost")).toEqual({
      valid: false,
      reason: "too_few_labels",
    });
  });

  it("rejects labels starting with a hyphen", () => {
    expect(validateHostname("-bad.com")).toEqual({
      valid: false,
      reason: "label_invalid",
    });
  });

  it("rejects labels over 63 chars", () => {
    const label = "a".repeat(64);
    expect(validateHostname(`${label}.com`)).toEqual({
      valid: false,
      reason: "label_invalid",
    });
  });

  it("rejects FQDN over 253 chars", () => {
    const labels = Array.from({ length: 20 }, () => "a".repeat(15));
    const hostname = labels.join(".") + ".com"; // comfortably > 253
    expect(validateHostname(hostname).valid).toBe(false);
  });
});
