import { describe, it, expect } from "vitest";
import { compositeKey } from "../useRemovableList";

// ---------------------------------------------------------------------------
// compositeKey
// ---------------------------------------------------------------------------

describe("compositeKey", () => {
  it("joins org and entity id with a dash", () => {
    expect(compositeKey(1, 2)).toBe("1-2");
  });

  it("handles zero values", () => {
    expect(compositeKey(0, 0)).toBe("0-0");
  });

  it("handles large ids", () => {
    expect(compositeKey(999999, 888888)).toBe("999999-888888");
  });

  it("produces unique keys for different pairs", () => {
    expect(compositeKey(1, 2)).not.toBe(compositeKey(2, 1));
  });

  it("produces the same key for the same pair", () => {
    expect(compositeKey(5, 10)).toBe(compositeKey(5, 10));
  });
});
