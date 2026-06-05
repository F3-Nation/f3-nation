import { describe, it, expect } from "vitest";
import { isValidReturnTo, safeReturnTo } from "@/lib/auth/validation";

describe("isValidReturnTo", () => {
  it("accepts simple relative paths", () => {
    expect(isValidReturnTo("/profile")).toBe(true);
    expect(isValidReturnTo("/profile/settings")).toBe(true);
    expect(isValidReturnTo("/")).toBe(true);
  });

  it("rejects paths that do not start with /", () => {
    expect(isValidReturnTo("profile")).toBe(false);
    expect(isValidReturnTo("https://evil.com")).toBe(false);
    expect(isValidReturnTo("")).toBe(false);
  });

  it("rejects protocol-relative URLs starting with //", () => {
    expect(isValidReturnTo("//evil.com")).toBe(false);
  });

  it("rejects paths starting with /\\", () => {
    expect(isValidReturnTo("/\\evil.com")).toBe(false);
  });

  it("rejects paths containing backslashes", () => {
    expect(isValidReturnTo("/path\\evil")).toBe(false);
  });

  it("rejects paths containing CR, LF, or tab", () => {
    expect(isValidReturnTo("/path\revil")).toBe(false);
    expect(isValidReturnTo("/path\nevil")).toBe(false);
    expect(isValidReturnTo("/path\tevil")).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("returns the path when valid", () => {
    expect(safeReturnTo("/profile")).toBe("/profile");
    expect(safeReturnTo("/settings")).toBe("/settings");
  });

  it("falls back to /profile for null or undefined", () => {
    expect(safeReturnTo(null)).toBe("/profile");
    expect(safeReturnTo(undefined)).toBe("/profile");
  });

  it("falls back to /profile for empty string", () => {
    expect(safeReturnTo("")).toBe("/profile");
  });

  it("falls back to /profile for invalid paths", () => {
    expect(safeReturnTo("//evil.com")).toBe("/profile");
    expect(safeReturnTo("https://evil.com")).toBe("/profile");
  });
});
