import { describe, expect, it } from "vitest";

import { toStoredTime } from "~/utils/form-values";

describe("toStoredTime", () => {
  it("converts a filled HH:mm input to the stored HHmm form", () => {
    expect(toStoredTime("05:30")).toBe("0530");
    expect(toStoredTime("23:59")).toBe("2359");
    expect(toStoredTime("00:00")).toBe("0000");
  });

  // The regression this guards: returning undefined for a cleared field drops
  // the key from the request body, Drizzle omits undefined from the SET clause,
  // and the previously stored time survives — clearing appears to do nothing.
  it("maps a cleared input to null rather than undefined", () => {
    expect(toStoredTime("")).toBeNull();
    expect(toStoredTime("")).not.toBeUndefined();
  });

  it("maps an absent value to null", () => {
    expect(toStoredTime(null)).toBeNull();
    expect(toStoredTime(undefined)).toBeNull();
  });

  // convertHH_mmToHHmm returns "" for any non-5-character input, so a partial
  // value must not reach it — persisting "" instead of null would leave a
  // non-null empty string in a nullable varchar column.
  it("maps a partial value to null instead of an empty string", () => {
    expect(toStoredTime("5")).toBeNull();
    expect(toStoredTime("05:3")).toBeNull();
    expect(toStoredTime("05:30:00")).toBeNull();
  });
});
