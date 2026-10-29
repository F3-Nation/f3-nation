import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Workout } from "@/types/region";
import { WorkoutListView } from "@/components/workout-list";

const at = (id: string, group: string): Workout =>
  ({
    id,
    regionId: "1",
    name: `Workout ${id}`,
    time: "6:00 AM",
    type: "Run",
    types: ["Run"],
    group,
    notes: null,
    latitude: null,
    longitude: null,
    location: "",
    city: null,
    state: null,
    zip: null,
    country: null,
  }) satisfies Workout;

describe("WorkoutListView", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels a day's second run as next week, in order", () => {
    render(
      <WorkoutListView
        workouts={[at("1", "thursday"), at("2", "friday"), at("3", "thursday")]}
        day={null}
        type={null}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Thursday",
      "Workout 1",
      "Friday",
      "Workout 2",
      "Thursday (next week)",
      "Workout 3",
    ]);
  });
});
