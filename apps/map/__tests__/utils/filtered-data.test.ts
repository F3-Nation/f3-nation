import { describe, expect, it } from "vitest";

import type { DayOfWeek } from "@acme/shared/app/enums";

import type { FiltersType } from "~/utils/store/filter";
import { filterData, selectedDaysOfWeek } from "~/utils/filtered-data";
import {
  activeFilterCount,
  initialFilterState,
  TimeSelection,
} from "~/utils/store/filter";

const DAYS: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// One location with a 5:30 AM workout every day of the week.
const week = [
  {
    id: 1,
    events: DAYS.map((dayOfWeek, i) => ({
      id: i + 1,
      dayOfWeek,
      startTime: "0530",
      eventTypes: [{ id: 1, name: "Bootcamp" }],
    })),
  },
];

const daysLeft = (filters: Partial<FiltersType>) =>
  filterData(week, { ...initialFilterState, ...filters }).flatMap((m) =>
    m.events.map((e) => e.dayOfWeek),
  );

describe("This weekend quick pick", () => {
  it("keeps only Saturday and Sunday workouts", () => {
    expect(daysLeft({ weekend: true })).toEqual(["sunday", "saturday"]);
  });

  it("adds the weekend to days already picked", () => {
    expect(daysLeft({ weekend: true, dayW: true })).toEqual([
      "sunday",
      "wednesday",
      "saturday",
    ]);
  });

  it("keeps every day when it is off", () => {
    expect(daysLeft({})).toHaveLength(7);
  });

  it("drops a location with no weekend workout", () => {
    const weekdays = [
      {
        id: 2,
        events: [
          {
            id: 9,
            dayOfWeek: "monday" as const,
            startTime: "0530",
            eventTypes: [],
          },
        ],
      },
    ];
    expect(
      filterData(weekdays, { ...initialFilterState, weekend: true }),
    ).toEqual([]);
  });

  it("is part of the day set", () => {
    expect([
      ...selectedDaysOfWeek({ ...initialFilterState, weekend: true }),
    ]).toEqual(["sunday", "saturday"]);
    expect(selectedDaysOfWeek(initialFilterState).size).toBe(0);
  });
});

describe("activeFilterCount", () => {
  it("counts days, time and type as one each", () => {
    expect(activeFilterCount(initialFilterState)).toBe(0);
    expect(
      activeFilterCount({
        ...initialFilterState,
        dayTu: true,
        dayTh: true,
        am: true,
        nationalEventTypeIds: [1],
      }),
    ).toBe(3);
  });

  it("counts This weekend and a start-time cutoff", () => {
    expect(activeFilterCount({ ...initialFilterState, weekend: true })).toBe(1);
    expect(
      activeFilterCount({
        ...initialFilterState,
        beforeAfterTime: TimeSelection["6am"],
      }),
    ).toBe(1);
  });
});
