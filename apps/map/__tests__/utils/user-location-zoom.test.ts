import { describe, expect, it } from "vitest";

import { USER_LOCATION_ZOOM } from "@acme/shared/app/constants";

import {
  getUserLocationZoom,
  parseZoomParam,
} from "~/utils/user-location-zoom";

describe("getUserLocationZoom", () => {
  it("opens at about a 25-30 mile radius by default", () => {
    expect(USER_LOCATION_ZOOM).toBe(10);
    expect(getUserLocationZoom("")).toBe(10);
  });

  it("uses the zoom query param when an embed sets one", () => {
    expect(getUserLocationZoom("?zoom=8")).toBe(8);
    expect(getUserLocationZoom("?auto=yes&zoom=11.5")).toBe(11.5);
    expect(getUserLocationZoom("?zoom=0")).toBe(0);
  });

  it("ignores a zoom param that is not a finite number", () => {
    expect(getUserLocationZoom("?zoom=close")).toBe(10);
    expect(getUserLocationZoom("?zoom=Infinity")).toBe(10);
  });
});

describe("parseZoomParam", () => {
  it("returns undefined when the param is missing or not finite", () => {
    expect(parseZoomParam(null)).toBeUndefined();
    expect(parseZoomParam("abc")).toBeUndefined();
    expect(parseZoomParam("-Infinity")).toBeUndefined();
  });

  it("clamps to the zoom levels Google Maps supports", () => {
    expect(parseZoomParam("1e9")).toBe(22);
    expect(parseZoomParam("-5")).toBe(0);
    expect(parseZoomParam("12")).toBe(12);
  });
});
