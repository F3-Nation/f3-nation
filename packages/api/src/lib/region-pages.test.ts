import { describe, expect, it } from "vitest";

import type { RegionPageWorkout, RegionPageWorkoutRow } from "./region-pages";
import {
  dedupeWorkouts,
  formatClockTime,
  formatTimeRange,
  httpUrlOrNull,
  normalizeEmail,
  normalizeFacebookUrl,
  normalizeInstagramUrl,
  normalizeTwitterUrl,
  regionSlug,
  summarizeRegionArea,
  toRegionPageRegion,
  toRegionPageWorkout,
  uniqueBySlug,
} from "./region-pages";

const row = (
  overrides: Partial<RegionPageWorkoutRow> = {},
): RegionPageWorkoutRow => ({
  id: 10,
  regionId: 1,
  name: "The Foundry",
  dayOfWeek: "friday",
  startTime: "0515",
  endTime: "0600",
  description: "Meet in the lot",
  latitude: 35.2,
  longitude: -106.6,
  addressStreet: "2006 Grande Blvd SE",
  addressStreet2: null,
  addressCity: "Rio Rancho",
  addressState: "NM",
  addressZip: "87124",
  addressCountry: "US",
  eventTypeNames: ["Bootcamp"],
  ...overrides,
});

const workout = (
  overrides: Partial<RegionPageWorkout> = {},
): RegionPageWorkout => {
  const base = toRegionPageWorkout(row());
  if (!base) throw new Error("fixture row must be valid");
  return { ...base, ...overrides };
};

describe("regionSlug", () => {
  it("kebab-cases the region name like the legacy app", () => {
    expect(regionSlug("Albany, GA")).toBe("albany-ga");
    expect(regionSlug("ARCO")).toBe("arco");
    expect(regionSlug("Albuquerque")).toBe("albuquerque");
  });
});

describe("uniqueBySlug", () => {
  it("keeps the lowest-id region when names share a slug", () => {
    const result = uniqueBySlug([
      { id: 1, name: "Albany, GA" },
      { id: 2, name: "Albany GA" },
      { id: 3, name: "Boone" },
    ]);
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("social and contact normalization", () => {
  it("keeps only emails with an @", () => {
    expect(normalizeEmail(" pax@f3.com ")).toBe("pax@f3.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it.each([
    ["@F3ABQ", "https://x.com/F3ABQ"],
    ["F3ABQ", "https://x.com/F3ABQ"],
    ["https://twitter.com/F3ABQ", "https://x.com/F3ABQ"],
    ["https://www.x.com/@F3ABQ?s=21", "https://x.com/F3ABQ"],
    ["https://example.com/F3ABQ", null],
  ])("twitter %s -> %s", (input, expected) => {
    expect(normalizeTwitterUrl(input)).toBe(expected);
  });

  it.each([
    ["https://www.facebook.com/f3abq/", "https://facebook.com/f3abq"],
    [
      "https://facebook.com/profile.php?id=123",
      "https://facebook.com/profile.php?id=123",
    ],
    [
      "https://www.facebook.com/groups/f3abq/",
      "https://facebook.com/groups/f3abq",
    ],
    ["f3abq", null],
    ["facebook.com/f3abq", "https://facebook.com/f3abq"],
    ["https://evil.example/facebook.com/profile.php?id=123", null],
    ["https://facebook.com/profile.php?id=abc", null],
  ])("facebook %s -> %s", (input, expected) => {
    expect(normalizeFacebookUrl(input)).toBe(expected);
  });

  it.each([
    ["https://instagram.com/f3abq/", "https://instagram.com/f3abq"],
    ["@f3abq", "https://instagram.com/f3abq"],
    ["not a handle!", null],
  ])("instagram %s -> %s", (input, expected) => {
    expect(normalizeInstagramUrl(input)).toBe(expected);
  });
});

describe("httpUrlOrNull", () => {
  it.each([
    ["https://f3abq.com/", "https://f3abq.com/"],
    [" http://f3abq.com ", "http://f3abq.com"],
    ["javascript:alert(1)", null],
    ["data:text/html,hi", null],
    ["f3abq.com", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(httpUrlOrNull(input)).toBe(expected);
  });

  it("drops a javascript: URL dressed up as a Facebook profile", () => {
    expect(
      normalizeFacebookUrl("javascript:alert(1)//facebook.com/profile.php"),
    ).toBeNull();
  });
});

describe("time formatting", () => {
  it.each([
    ["0515", "5:15 AM"],
    ["05:15", "5:15 AM"],
    ["1200", "12:00 PM"],
    ["0000", "12:00 AM"],
    ["1830", "6:30 PM"],
    ["2460", "2460"],
    ["TBD", "TBD"],
  ])("formatClockTime(%s) = %s", (input, expected) => {
    expect(formatClockTime(input)).toBe(expected);
  });

  it("formats ranges and single times", () => {
    expect(formatTimeRange("0515", "0600")).toBe("5:15 AM - 6:00 AM");
    expect(formatTimeRange("0515", null)).toBe("5:15 AM");
    expect(formatTimeRange(null, "0600")).toBe("6:00 AM");
    expect(formatTimeRange(null, null)).toBe("");
  });
});

describe("toRegionPageWorkout", () => {
  it("shapes a row like the legacy workouts table", () => {
    expect(
      toRegionPageWorkout(row({ eventTypeNames: ["Run", "Ruck"] })),
    ).toEqual({
      id: "10",
      regionId: "1",
      name: "The Foundry",
      time: "5:15 AM - 6:00 AM",
      type: "Run",
      types: ["Run", "Ruck"],
      group: "friday",
      notes: "Meet in the lot",
      latitude: 35.2,
      longitude: -106.6,
      location: "2006 Grande Blvd SE, Rio Rancho, NM, 87124, US",
      city: "Rio Rancho",
      state: "NM",
      zip: "87124",
      country: "US",
    });
  });

  it("skips rows without an event type or day of week", () => {
    expect(toRegionPageWorkout(row({ eventTypeNames: [] }))).toBeNull();
    expect(toRegionPageWorkout(row({ eventTypeNames: null }))).toBeNull();
    expect(toRegionPageWorkout(row({ dayOfWeek: null }))).toBeNull();
  });
});

describe("dedupeWorkouts", () => {
  it("keeps the highest event id per schedule identity, sorted by name", () => {
    const older = workout({ id: "5" });
    const newer = workout({ id: "9" });
    const otherDay = workout({ id: "3", group: "monday" });
    const alpha = workout({ id: "1", name: "Alpha" });

    const result = dedupeWorkouts([newer, older, otherDay, alpha]);

    expect(result.map((w) => w.id)).toEqual(["1", "3", "9"]);
  });

  it("keeps same-named workouts at different times or places", () => {
    const result = dedupeWorkouts([
      workout({ id: "1" }),
      workout({ id: "2", time: "6:00 AM - 7:00 AM" }),
      workout({ id: "3", location: "Somewhere else" }),
    ]);
    expect(result).toHaveLength(3);
  });
});

describe("summarizeRegionArea", () => {
  it("reports no location when no workout has coordinates", () => {
    expect(
      summarizeRegionArea([workout({ latitude: null, longitude: null })]),
    ).toMatchObject({ latitude: null, longitude: null, zoom: null });
    expect(summarizeRegionArea([])).toEqual({
      city: null,
      state: null,
      zip: null,
      country: null,
      latitude: null,
      longitude: null,
      zoom: null,
    });
  });

  it("uses the most common zip's address and frames every pin", () => {
    const area = summarizeRegionArea([
      workout({
        zip: "87124",
        city: "Rio Rancho",
        latitude: 35,
        longitude: -107,
      }),
      workout({
        zip: "87111",
        city: "Albuquerque",
        latitude: 35.2,
        longitude: -106.5,
      }),
      workout({
        zip: "87111",
        city: "Albuquerque",
        latitude: 35.1,
        longitude: -106.6,
      }),
    ]);

    expect(area.city).toBe("Albuquerque");
    expect(area.zip).toBe("87111");
    expect(area.latitude).toBeCloseTo(35.1);
    expect(area.longitude).toBeCloseTo(-106.75);
    // Legacy enrich-regions.ts: floor(15.5 - log2(0.5° * 1.4 padding * 111 km)).
    expect(area.zoom).toBe(9);
  });

  it("clamps a single pin to the closest zoom", () => {
    expect(summarizeRegionArea([workout()]).zoom).toBe(13);
  });
});

describe("toRegionPageRegion", () => {
  it("combines org fields, normalized socials and the workout area", () => {
    const region = toRegionPageRegion(
      {
        id: 28893,
        name: "Albuquerque",
        description: null,
        website: "https://www.f3abq.com/",
        logoUrl: "https://storage.googleapis.com/f3-logos/abq.png",
        email: "nope",
        facebook: null,
        twitter: "@F3ABQ",
        instagram: null,
      },
      [workout()],
    );

    expect(region).toMatchObject({
      id: "28893",
      slug: "albuquerque",
      image: "https://storage.googleapis.com/f3-logos/abq.png",
      email: null,
      twitter: "https://x.com/F3ABQ",
      workoutCount: 1,
      city: "Rio Rancho",
    });
  });
});
