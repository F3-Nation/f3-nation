import { describe, expect, it } from "vitest";

import type { Workout } from "@/types/region";
import { filterWorkouts, groupByDayInOrder } from "@/lib/workout-filters";

const w = (id: string, group: string, types: string[]): Workout =>
  ({ id, group, type: types[0] ?? "", types }) as Workout;

const friRun = w("1", "friday", ["Run"]);
const friBoot = w("2", "friday", ["Bootcamp"]);
const monRun = w("3", "monday", ["Run", "Ruck"]);

describe("filterWorkouts", () => {
  it("applies day and type together", () => {
    expect(
      filterWorkouts([friRun, friBoot, monRun], { day: "Friday", type: "run" }),
    ).toEqual([friRun]);
  });

  it("matches any of a workout's types and returns all with no filters", () => {
    expect(filterWorkouts([friRun, monRun], { type: "ruck" })).toEqual([
      monRun,
    ]);
    expect(filterWorkouts([friRun, monRun], {})).toEqual([friRun, monRun]);
  });
});

describe("filterWorkouts with untrimmed type names", () => {
  it("matches a stored type that has surrounding spaces", () => {
    const spaced = w("4", "monday", [" Bootcamp "]);
    expect(filterWorkouts([spaced, monRun], { type: "bootcamp" })).toEqual([
      spaced,
    ]);
  });
});

describe("groupByDayInOrder", () => {
  it("keeps next-occurrence order instead of Monday-first", () => {
    // Sorted for a Thursday: Friday comes before Monday.
    expect(
      groupByDayInOrder([friRun, friBoot, monRun]).map(([day]) => day),
    ).toEqual(["friday", "monday"]);
  });
});
