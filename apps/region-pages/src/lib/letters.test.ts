import { describe, expect, it } from "vitest";
import {
  ALL_LETTERS,
  groupRegionsByLetter,
  resolveLetter,
} from "@/lib/letters";

describe("ALL_LETTERS", () => {
  it("contains A through Z in order", () => {
    expect(ALL_LETTERS).toHaveLength(26);
    expect(ALL_LETTERS[0]).toBe("A");
    expect(ALL_LETTERS[25]).toBe("Z");
    expect(ALL_LETTERS.join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});

describe("groupRegionsByLetter", () => {
  it("returns a key for every letter, even empty ones", () => {
    const grouped = groupRegionsByLetter<{ name: string }>([]);

    expect(Object.keys(grouped)).toEqual(ALL_LETTERS);
    for (const letter of ALL_LETTERS) {
      expect(grouped[letter]).toEqual([]);
    }
  });

  it("groups regions by the first letter of their name, case-insensitively", () => {
    const atlanta = { name: "atlanta" };
    const austin = { name: "Austin" };
    const boston = { name: "Boston" };

    const grouped = groupRegionsByLetter([atlanta, austin, boston]);

    expect(grouped.A).toEqual([atlanta, austin]);
    expect(grouped.B).toEqual([boston]);
    expect(grouped.C).toEqual([]);
  });

  it("drops regions whose names do not start with a letter", () => {
    const grouped = groupRegionsByLetter([{ name: "2nd Ward" }]);

    const total = Object.values(grouped).reduce(
      (count, regions) => count + regions.length,
      0,
    );
    expect(total).toBe(0);
  });

  it("preserves the original region objects", () => {
    const region = { name: "Zulu", extra: 1 };

    const grouped = groupRegionsByLetter([region]);

    expect(grouped.Z?.[0]).toBe(region);
  });
});

describe("resolveLetter", () => {
  it("defaults to A when the param is missing", () => {
    expect(resolveLetter(null)).toBe("A");
    expect(resolveLetter(undefined)).toBe("A");
  });

  it("defaults to A for an empty string", () => {
    expect(resolveLetter("")).toBe("A");
  });

  it("returns a valid letter unchanged", () => {
    expect(resolveLetter("M")).toBe("M");
  });

  it("normalizes lowercase input to uppercase", () => {
    expect(resolveLetter("z")).toBe("Z");
  });

  it("falls back to A for invalid input", () => {
    expect(resolveLetter("7")).toBe("A");
    expect(resolveLetter("AB")).toBe("A");
    expect(resolveLetter("!")).toBe("A");
  });
});
