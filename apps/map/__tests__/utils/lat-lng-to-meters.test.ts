import { describe, expect, it } from "vitest";

import { latLngToMeters } from "~/utils/lat-lng-to-meters";

describe("latLngToMeters", () => {
  it("returns 0 when any coordinate is undefined", () => {
    expect(latLngToMeters(undefined, -80.84, 35.23, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, undefined, 35.23, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, -80.84, undefined, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, -80.84, 35.23, undefined)).toBe(0);
  });

  it("returns 0 when any coordinate is null", () => {
    expect(latLngToMeters(null, -80.84, 35.23, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, null, 35.23, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, -80.84, null, -80.84)).toBe(0);
    expect(latLngToMeters(35.23, -80.84, 35.23, null)).toBe(0);
  });

  it("returns 0 for identical coordinates", () => {
    expect(latLngToMeters(35.2271, -80.8431, 35.2271, -80.8431)).toBe(0);
  });

  it("computes haversine distance in meters", () => {
    // One degree of latitude is ~111.19 km everywhere on Earth.
    const oneDegreeNorth = latLngToMeters(0, 0, 1, 0);
    expect(oneDegreeNorth).toBeCloseTo(111_195, -1);

    // Berlin to Paris (~877 km).
    const berlinToParis = latLngToMeters(52.52, 13.405, 48.8566, 2.3522);
    expect(berlinToParis).toBeCloseTo(877_463, -1);
  });
});
