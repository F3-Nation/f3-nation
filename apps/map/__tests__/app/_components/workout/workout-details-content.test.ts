import { describe, expect, it } from "vitest";

import type { RouterOutputs } from "~/orpc/types";
import { createWorkoutEventFromInstance } from "~/app/_components/workout/workout-details-content";

type UpcomingInstance =
  RouterOutputs["map"]["location"]["upcomingInstances"][number];

describe("createWorkoutEventFromInstance", () => {
  it("maps an upcoming instance into a selectable workout-details event", () => {
    const instance: UpcomingInstance = {
      id: 42,
      seriesId: null,
      locationId: 10,
      startDate: "2026-05-16",
      startTime: "0630",
      endTime: "0730",
      seriesException: null,
      highlight: true,
      name: "Roving Saturday Beatdown",
      lat: 35.5,
      lon: -80.5,
      aoName: "Alpha AO",
      aoLogo: "alpha.png",
      locationAddress: "123 Main St",
      locationAddress2: null,
      locationCity: "Charlotte",
      locationState: "NC",
      locationCountry: "US",
      fullAddress: "123 Main St, Charlotte, NC",
      eventTypes: [{ id: 1, name: "Bootcamp" }],
    };

    expect(createWorkoutEventFromInstance(instance)).toEqual(
      expect.objectContaining({
        id: -42,
        name: "Roving Saturday Beatdown",
        dayOfWeek: "saturday",
        startTime: "0630",
        endTime: "0730",
        aoName: "Alpha AO",
        aoLogo: "alpha.png",
        eventTypes: [{ id: 1, name: "Bootcamp" }],
      }),
    );
  });
});
