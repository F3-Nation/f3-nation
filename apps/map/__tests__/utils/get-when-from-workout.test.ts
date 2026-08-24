import { describe, expect, it } from "vitest";

import { getWhenFromWorkout } from "~/utils/get-when-from-workout";

describe("getWhenFromWorkout", () => {
  it("returns an empty string when the workout has no day or times", () => {
    expect(
      getWhenFromWorkout({
        startTime: null,
        endTime: null,
        dayOfWeek: null,
      }),
    ).toBe("");
  });
});
