import { describe, expect, it } from "vitest";

import { parseOptionalSize } from "./parse-size";

describe("parseOptionalSize", () => {
  it("returns undefined when absent", () => {
    expect(parseOptionalSize(null)).toBeUndefined();
  });

  it("parses a valid positive integer", () => {
    expect(parseOptionalSize("128")).toBe(128);
  });

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid size %p",
    (raw) => {
      expect(parseOptionalSize(raw)).toBe("invalid");
    },
  );
});
