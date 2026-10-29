import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "@/types/region";
import { useUpcomingOrder } from "@/lib/use-upcoming-order";
import { sortWorkoutsByWeek } from "@/lib/workout-sorting";

const workout = (name: string, group: string, time: string): Workout =>
  ({ id: name, name, group, time, type: "Run", types: ["Run"] }) as Workout;

function Names({ workouts }: { workouts: Workout[] }) {
  return (
    <p>
      {useUpcomingOrder(workouts)
        .map((w) => w.name)
        .join(",")}
    </p>
  );
}

// Thursday 10:30 local: Thursday's 5:30 AM workout has already happened.
const week = sortWorkoutsByWeek([
  workout("Thu", "thursday", "5:30 AM"),
  workout("Fri", "friday", "5:30 AM"),
  workout("Mon", "monday", "5:30 AM"),
]);

describe("useUpcomingOrder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T10:30:00"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps week order on the server, so it matches the hydration pass", () => {
    expect(renderToString(<Names workouts={week} />)).toBe(
      "<p>Mon,Thu,Fri</p>",
    );
  });

  it("re-sorts by next occurrence on the visitor's clock in the browser", () => {
    const { container } = render(<Names workouts={week} />);
    expect(container.textContent).toBe("Fri,Mon,Thu");
  });
});
