import { describe, expect, it } from "vitest";

import {
  ALL_LETTERS,
  groupRegionsByLetter,
  resolveLetter,
} from "@/lib/letters";

describe("groupRegionsByLetter", () => {
  it("has a key per letter and groups by first letter, case-insensitively", () => {
    const atlanta = { name: "atlanta" };
    const austin = { name: "Austin" };
    const boston = { name: "Boston" };

    const grouped = groupRegionsByLetter([atlanta, austin, boston]);

    expect(Object.keys(grouped)).toEqual(ALL_LETTERS);
    expect(grouped.A).toEqual([atlanta, austin]);
    expect(grouped.B).toEqual([boston]);
    expect(grouped.C).toEqual([]);
  });

  it("drops regions whose names do not start with a letter", () => {
    const grouped = groupRegionsByLetter([{ name: "2nd Ward" }]);
    expect(Object.values(grouped).flat()).toEqual([]);
  });
});

describe("resolveLetter", () => {
  it.each([
    [null, "A"],
    [undefined, "A"],
    ["", "A"],
    ["M", "M"],
    ["z", "Z"],
    ["7", "A"],
    ["AB", "A"],
  ])("%j -> %s", (input, expected) => {
    expect(resolveLetter(input)).toBe(expected);
  });
});
