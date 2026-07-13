import { describe, expect, it } from "vitest";

import { getWhenFromWorkout } from "~/utils/get-when-from-workout";

const base = {
  startTime: null,
  endTime: null,
  dayOfWeek: "monday" as const,
};

describe("getWhenFromWorkout", () => {
  it("renders a plain weekly event with no prefix", () => {
    expect(getWhenFromWorkout({ ...base })).toBe("Monday");
  });

  it("renders a null recurrence pattern with no prefix", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: null,
        recurrenceInterval: 3,
      }),
    ).toBe("Monday");
  });

  it("renders every-other-week for interval 2", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: "weekly",
        recurrenceInterval: 2,
      }),
    ).toBe("Every other Monday");
  });

  it("renders every-N-weeks for interval > 2", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: "weekly",
        recurrenceInterval: 3,
      }),
    ).toBe("Every 3 weeks on Monday");
  });

  it("renders an ordinal for a monthly event with an occurrence index", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: "monthly",
        indexWithinInterval: 3,
      }),
    ).toBe("3rd Monday");
  });

  it("renders a defensive fallback for monthly with no occurrence index", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: "monthly",
        indexWithinInterval: null,
      }),
    ).toBe("Monthly on Monday");
  });

  it("does not apply the weekly interval prefix to monthly events", () => {
    expect(
      getWhenFromWorkout({
        ...base,
        recurrencePattern: "monthly",
        recurrenceInterval: 2,
        indexWithinInterval: 1,
      }),
    ).toBe("Every other month on 1st Monday");
  });
});
