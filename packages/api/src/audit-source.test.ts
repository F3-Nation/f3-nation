import { describe, expect, it } from "vitest";

import { toAuditSource } from "./audit-source";

describe("audit source normalization", () => {
  it.each([
    ["f3-map", "map"],
    ["f3-admin", "admin"],
    ["f3-me", "me"],
    ["f3-region-pages", "region-pages"],
    ["f3-nation-slack-bot", "slackbot"],
    ["orpc-ssg", "map-ssg"],
    ["scalar-api", "scalar-api"],
    [null, null],
    [undefined, null],
    ["", null],
    ["orpc", null],
    ["garbage", null],
    ["F3-MAP", null],
    [" f3-map ", null],
    ["__proto__", null],
    ["constructor", null],
  ])("normalizes %s to %s", (header, expected) => {
    expect(toAuditSource(header)).toBe(expected);
  });
});
