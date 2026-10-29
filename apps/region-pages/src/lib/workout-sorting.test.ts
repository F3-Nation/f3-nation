import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sortWorkoutsByDayAndTime,
  sortWorkoutsByWeek,
} from "@/lib/workout-sorting";
import type { Workout } from "@/types/region";

// Thursday, 2024-02-01 10:30 local time.
const NOW = new Date("2024-02-01T10:30:00");

const makeWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "workout-1",
  regionId: "region-1",
  name: "Morning Mayhem",
  time: "5:30 AM - 6:15 AM",
  type: "Bootcamp",
  types: ["Bootcamp"],
  group: "thursday",
  notes: null,
  latitude: null,
  longitude: null,
  location: "Central Park",
  city: null,
  state: null,
  zip: null,
  country: null,
  ...overrides,
});

const namesOf = (workouts: Workout[]): string[] => workouts.map((w) => w.name);

describe("sortWorkoutsByDayAndTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders upcoming workouts by next occurrence", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({
        id: "a",
        name: "Wed",
        group: "wednesday",
        time: "6:00 AM",
      }),
      makeWorkout({ id: "b", name: "Fri", group: "friday", time: "6:00 AM" }),
      makeWorkout({ id: "c", name: "Sat", group: "saturday", time: "6:00 AM" }),
    ]);

    expect(namesOf(sorted)).toEqual(["Fri", "Sat", "Wed"]);
  });

  it("moves a workout that already started today to next week", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({ name: "Earlier Today", time: "5:30 AM - 6:15 AM" }),
      makeWorkout({ name: "Friday", group: "friday", time: "6:00 AM" }),
    ]);

    // Thursday 5:30 AM already passed, so it lands on Thursday Feb 8, after Friday Feb 2.
    expect(namesOf(sorted)).toEqual(["Friday", "Earlier Today"]);
  });

  it("puts a later-today workout ahead of tomorrow", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({ name: "Friday", group: "friday", time: "6:00 AM" }),
      makeWorkout({ name: "Later Today", time: "7:00 PM - 8:00 PM" }),
    ]);

    expect(namesOf(sorted)).toEqual(["Later Today", "Friday"]);
  });

  it("treats 12 PM as noon and 12 AM as midnight when deciding if today has passed", () => {
    const sorted = sortWorkoutsByDayAndTime([
      // 12:00 AM is before 10:30 AM, so this is pushed to next week.
      makeWorkout({ name: "Midnight", time: "12:00 AM - 1:00 AM" }),
      // 12:15 PM is still ahead today.
      makeWorkout({ name: "Noon", time: "12:15 PM - 1:00 PM" }),
    ]);

    expect(namesOf(sorted)).toEqual(["Noon", "Midnight"]);
  });

  it("breaks ties on identical next occurrence by name", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({ id: "z", name: "Zulu", group: "friday", time: "6:00 AM" }),
      makeWorkout({ id: "a", name: "Alpha", group: "friday", time: "6:00 AM" }),
    ]);

    expect(namesOf(sorted)).toEqual(["Alpha", "Zulu"]);
  });

  it("sorts workouts with an unknown day last", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({ name: "Mystery", group: "someday", time: "6:00 AM" }),
      makeWorkout({ name: "Sunday", group: "sunday", time: "6:00 AM" }),
    ]);

    expect(namesOf(sorted)).toEqual(["Sunday", "Mystery"]);
  });

  it("matches day names case-insensitively and ignores surrounding whitespace", () => {
    const sorted = sortWorkoutsByDayAndTime([
      makeWorkout({ name: "Sunday", group: " SUNDAY ", time: "6:00 AM" }),
      makeWorkout({ name: "Monday", group: "Monday", time: "6:00 AM" }),
    ]);

    // Sunday Feb 4 comes before Monday Feb 5 when counting from Thursday.
    expect(namesOf(sorted)).toEqual(["Sunday", "Monday"]);
  });
});

describe("sortWorkoutsByWeek", () => {
  it("orders Monday to Sunday, then by start time, unknown days last", () => {
    const sorted = sortWorkoutsByWeek([
      makeWorkout({ name: "Sun", group: "sunday", time: "7:00 AM" }),
      makeWorkout({ name: "Mon late", group: "monday", time: "6:00 PM" }),
      makeWorkout({ name: "Odd", group: "someday", time: "5:00 AM" }),
      makeWorkout({ name: "Mon early", group: "monday", time: "5:30 AM" }),
    ]);
    expect(namesOf(sorted)).toEqual(["Mon early", "Mon late", "Sun", "Odd"]);
  });

  it("gives the same order whatever the clock says", () => {
    const workouts = [
      makeWorkout({ name: "Thu", group: "thursday", time: "5:30 AM" }),
      makeWorkout({ name: "Fri", group: "friday", time: "5:30 AM" }),
    ];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T23:00:00Z"));
    const late = namesOf(sortWorkoutsByWeek(workouts));
    vi.setSystemTime(new Date("2024-02-01T04:00:00Z"));
    const early = namesOf(sortWorkoutsByWeek(workouts));
    vi.useRealTimers();
    expect(late).toEqual(["Thu", "Fri"]);
    expect(early).toEqual(late);
  });
});
