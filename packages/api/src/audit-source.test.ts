import { describe, expect, it } from "vitest";

import { toAuditSource } from "./audit-source";

describe("audit source normalization", () => {
  it.each([
    ["f3-map", "f3-map"],
    ["f3-admin", "f3-admin"],
    ["f3-me", "f3-me"],
    ["f3-region-pages", "f3-region-pages"],
    ["f3-nation-slack-bot", "f3-nation-slack-bot"],
    ["orpc-ssg", "orpc-ssg"],
    ["scalar-api", "scalar-api"],
    [null, null],
    [undefined, null],
    ["", null],
    ["orpc", "orpc"],
    ["custom-website-42", "custom-website-42"],
    ["F3-MAP", "f3-map"],
    [" f3-map ", "f3-map"],
    ["My App! v2.0", "myappv20"],
    ["f3'; drop--", "f3drop--"],
    ["__proto__", "proto"],
    ["constructor", "constructor"],
    ["'\\;_!?", null],
    ["café-123", "caf-123"],
  ])("normalizes %s to %s", (header, expected) => {
    expect(toAuditSource(header)).toBe(expected);
  });

  it("retains at most 128 normalized characters", () => {
    expect(toAuditSource("A".repeat(127) + "!B-last")).toBe(
      "a".repeat(127) + "b",
    );
    expect(toAuditSource("!".repeat(128) + "Custom-App")).toBe("custom-app");
  });
});
