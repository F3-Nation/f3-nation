import { describe, expect, it, vi } from "vitest";

import type { Workout } from "@/types/region";
import { filterWorkouts, groupByDayRuns } from "@/lib/workout-filters";
import { sortWorkoutsByDayAndTime } from "@/lib/workout-sorting";

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

describe("groupByDayRuns", () => {
  it("keeps next-occurrence order instead of Monday-first", () => {
    // Sorted for a Thursday: Friday comes before Monday.
    expect(groupByDayRuns([friRun, friBoot, monRun]).map((g) => g.day)).toEqual(
      ["friday", "monday"],
    );
  });

  it("keeps next week's same-day workouts after tomorrow's", () => {
    // Thursday 05:45: 06:00 today is next, then Friday, then 05:30 next week.
    const at = (name: string, group: string, time: string) =>
      ({ id: name, name, group, time, type: "Run", types: ["Run"] }) as Workout;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T05:45:00"));
    const sorted = sortWorkoutsByDayAndTime([
      at("Thu 05:30", "thursday", "5:30 AM"),
      at("Thu 06:00", "thursday", "6:00 AM"),
      at("Fri 06:00", "friday", "6:00 AM"),
    ]);
    vi.useRealTimers();

    const groups = groupByDayRuns(sorted);

    expect(groups.flatMap((g) => g.workouts.map((x) => x.name))).toEqual([
      "Thu 06:00",
      "Fri 06:00",
      "Thu 05:30",
    ]);
    expect(groups.map((g) => [g.day, g.repeat])).toEqual([
      ["thursday", false],
      ["friday", false],
      ["thursday", true],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
  });
});
