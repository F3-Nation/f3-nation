import { describe, expect, it } from "vitest";

import type { LocationMarkerWithDistance } from "~/app/_components/map/filtered-map-results-provider";
import { filterData } from "~/utils/filtered-data";
import { initialFilterState } from "~/utils/store/filter";
import { groupMarkersByAo } from "~/utils/group-markers-by-ao";

const makeEvent = (
  overrides: Partial<LocationMarkerWithDistance["events"][number]> & {
    id: number;
  },
): LocationMarkerWithDistance["events"][number] => ({
  name: `Event ${overrides.id}`,
  dayOfWeek: "monday",
  startTime: "0530",
  eventTypes: [],
  aoName: null,
  aoLogo: null,
  startDate: null,
  endDate: null,
  mapStatus: null,
  ...overrides,
});

const makeMarker = (
  overrides: Partial<LocationMarkerWithDistance> & { id: number },
): LocationMarkerWithDistance => ({
  lat: 35.5,
  lon: -80.5,
  logo: null,
  aoName: "Default AO",
  fullAddress: "123 Main St",
  events: [],
  distance: 1.0,
  ...overrides,
});

describe("groupMarkersByAo", () => {
  it.each([
    {
      filter: "dayM",
      day: "monday",
      id: 101,
      name: "Screaming Eagle",
      logo: "eagle.png",
    },
    {
      filter: "dayW",
      day: "wednesday",
      id: 102,
      name: "Screaming Eagle",
      logo: "eagle.png",
    },
    {
      filter: "dayTh",
      day: "thursday",
      id: 103,
      name: "Affordable Thursday",
      logo: "thursday.png",
    },
  ])(
    "keeps the $day schedule paired with its AO after filtering",
    ({ filter, day, id, name, logo }) => {
      const marker = makeMarker({
        id: 1,
        aoName: "Affordable Thursday",
        logo: "thursday.png",
        events: [
          makeEvent({
            id: 101,
            name: "Screaming Eagle",
            aoName: "Screaming Eagle",
            aoLogo: "eagle.png",
            dayOfWeek: "monday",
          }),
          makeEvent({
            id: 102,
            name: "Screaming Eagle",
            aoName: "Screaming Eagle",
            aoLogo: "eagle.png",
            dayOfWeek: "wednesday",
          }),
          makeEvent({
            id: 103,
            name: "Affordable Thursday",
            aoName: "Affordable Thursday",
            aoLogo: "thursday.png",
            dayOfWeek: "thursday",
          }),
        ],
      });
      const result = groupMarkersByAo(
        filterData([marker], { ...initialFilterState, [filter]: true }),
      );
      expect(result).toHaveLength(1);
      expect(
        result[0]?.events.map((event) => ({
          id: event.id,
          day: event.dayOfWeek,
        })),
      ).toEqual([{ id, day }]);
      expect(result[0]?.aoName).toBe(name);
      expect(result[0]?.logo).toBe(logo);
      const reset = groupMarkersByAo(filterData([marker], initialFilterState));
      expect(
        reset.map((row) => ({
          name: row.aoName,
          ids: row.events.map((event) => event.id),
        })),
      ).toEqual([
        { name: "Screaming Eagle", ids: [101, 102] },
        { name: "Affordable Thursday", ids: [103] },
      ]);
    },
  );
  it.each([
    { events: [] },
    { events: [makeEvent({ id: 101 })] },
    { events: [makeEvent({ id: -101, aoName: "" })] },
  ])(
    "preserves location metadata when events have no AO metadata: $events",
    ({ events }) => {
      const marker = makeMarker({
        id: 1,
        aoName: "Fallback AO",
        logo: "fallback.png",
        events,
      });
      expect(groupMarkersByAo([marker])).toEqual([{ ...marker, aoId: "1" }]);
    },
  );

  it("splits a location with multiple AOs into separate entries", () => {
    const marker = makeMarker({
      id: 1,
      aoName: "Red Fox",
      logo: "red-fox.png",
      events: [
        makeEvent({ id: 101, aoName: "Red Fox", aoLogo: "red-fox.png" }),
        makeEvent({
          id: 102,
          aoName: "Red Fox",
          aoLogo: "red-fox.png",
          dayOfWeek: "saturday",
        }),
        makeEvent({
          id: 103,
          aoName: "Pavement Pounders",
          aoLogo: "pp.png",
          dayOfWeek: "friday",
        }),
      ],
    });

    const result = groupMarkersByAo([marker]);

    expect(result).toHaveLength(2);

    const redFox = result.find((m) => m.aoName === "Red Fox")!;
    expect(redFox).toBeDefined();
    expect(redFox.id).toBe(1);
    expect(redFox.events).toHaveLength(2);
    expect(redFox.logo).toBe("red-fox.png");

    const pp = result.find((m) => m.aoName === "Pavement Pounders")!;
    expect(pp).toBeDefined();
    expect(pp.id).toBe(1);
    expect(pp.events).toHaveLength(1);
    expect(pp.logo).toBe("pp.png");

    expect(redFox.aoId).not.toBe(pp.aoId);
  });

  it("keeps a single-AO location as one entry", () => {
    const marker = makeMarker({
      id: 1,
      aoName: "Red Fox",
      events: [
        makeEvent({ id: 101, aoName: "Red Fox" }),
        makeEvent({ id: 102, aoName: "Red Fox", dayOfWeek: "wednesday" }),
        makeEvent({ id: 103, aoName: "Red Fox", dayOfWeek: "friday" }),
      ],
    });

    const result = groupMarkersByAo([marker]);

    expect(result).toHaveLength(1);
    expect(result[0]!.aoName).toBe("Red Fox");
    expect(result[0]!.events).toHaveLength(3);
    expect(result[0]!.aoId).toBe("1");
  });

  it("produces search-consistent results: both AOs at a shared location are discoverable", () => {
    const markers: LocationMarkerWithDistance[] = [
      makeMarker({
        id: 1,
        aoName: "Red Fox",
        events: [
          makeEvent({ id: 101, aoName: "Red Fox" }),
          makeEvent({ id: 102, aoName: "Pavement Pounders" }),
        ],
      }),
    ];

    const grouped = groupMarkersByAo(markers);

    // Simulate the same AO-name search logic used in search-results-provider:
    // For each location marker, collect unique matching AO names from events.
    const searchForAo = (text: string) => {
      return markers.flatMap((location) => {
        const matchingAoNames = new Set<string>();
        for (const event of location.events) {
          if (event.aoName?.toLowerCase().includes(text.toLowerCase())) {
            matchingAoNames.add(event.aoName);
          }
        }
        return Array.from(matchingAoNames);
      });
    };

    // Both AO names should be findable via search
    expect(searchForAo("Red Fox")).toContain("Red Fox");
    expect(searchForAo("Pavement")).toContain("Pavement Pounders");

    // Both AOs should also appear in the grouped nearby list
    const nearbyAoNames = grouped.map((m) => m.aoName);
    expect(nearbyAoNames).toContain("Red Fox");
    expect(nearbyAoNames).toContain("Pavement Pounders");
  });

  it("preserves all entries and produces unique aoIds across mixed data", () => {
    const markers: LocationMarkerWithDistance[] = [
      // Location shared by 2 AOs
      makeMarker({
        id: 1,
        aoName: "Red Fox",
        events: [
          makeEvent({ id: 101, aoName: "Red Fox" }),
          makeEvent({ id: 102, aoName: "Pavement Pounders" }),
        ],
      }),
      // Standalone location with a single AO
      makeMarker({
        id: 2,
        aoName: "Iron Horse",
        events: [makeEvent({ id: 201, aoName: "Iron Horse" })],
      }),
    ];

    const result = groupMarkersByAo(markers);

    // 2 from the shared location + 1 from the standalone = 3 total
    expect(result).toHaveLength(3);

    const aoNames = result.map((m) => m.aoName);
    expect(aoNames).toContain("Red Fox");
    expect(aoNames).toContain("Pavement Pounders");
    expect(aoNames).toContain("Iron Horse");

    // All aoIds must be unique
    const aoIds = result.map((m) => m.aoId);
    expect(new Set(aoIds).size).toBe(aoIds.length);
  });
});
