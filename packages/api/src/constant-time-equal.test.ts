import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "@acme/shared/server/constant-time-equal";

describe("constantTimeEqual", () => {
  it("is true for equal strings", () => {
    expect(constantTimeEqual("secret-key", "secret-key")).toBe(true);
  });

  it("is false for unequal strings of the same length", () => {
    expect(constantTimeEqual("secret-key", "secret-kez")).toBe(false);
  });

  it("is false for strings of different lengths", () => {
    expect(constantTimeEqual("secret-key", "secret-key-longer")).toBe(false);
  });

  it("is false when either side is empty", () => {
    expect(constantTimeEqual("", "")).toBe(false);
    expect(constantTimeEqual("secret-key", "")).toBe(false);
    expect(constantTimeEqual("", "secret-key")).toBe(false);
  });

  it("is false when either side is missing", () => {
    expect(constantTimeEqual(undefined, undefined)).toBe(false);
    expect(constantTimeEqual(null, "secret-key")).toBe(false);
    expect(constantTimeEqual("secret-key", undefined)).toBe(false);
  });
});
