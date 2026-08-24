import { describe, expect, it } from "vitest";

import "~/utils/frontendDayjs";
import { getWhenFromWorkout } from "~/utils/get-when-from-workout";

describe("getWhenFromWorkout", () => {
  it("formats a condensed workout schedule", () => {
    expect(
      getWhenFromWorkout({
        startTime: "0500",
        endTime: "0600",
        dayOfWeek: "monday",
        condensed: true,
      }),
    ).toBe("Monday 5AM - 6AM (60min)");
  });

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
