import { describe, expect, it } from "vitest";

import {
  CLOSE_ZOOM,
  MAP_DEFAULT_THEME,
  USER_LOCATION_ZOOM,
} from "@acme/shared/app/constants";

import {
  getInitialZoom,
  getUserLocationZoom,
  parseZoomParam,
} from "~/utils/user-location-zoom";

describe("getUserLocationZoom", () => {
  it("opens at USER_LOCATION_ZOOM by default", () => {
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

describe("getInitialZoom", () => {
  it("uses the zoom param, including zero", () => {
    expect(
      getInitialZoom({ queryZoom: 0, hasQueryLocation: true, storedZoom: 5 }),
    ).toBe(0);
    expect(
      getInitialZoom({ queryZoom: 8, hasQueryLocation: false, storedZoom: 5 }),
    ).toBe(8);
  });

  it("opens a URL location at street level", () => {
    expect(
      getInitialZoom({
        queryZoom: undefined,
        hasQueryLocation: true,
        storedZoom: 5,
      }),
    ).toBe(CLOSE_ZOOM);
  });

  it("falls back to the stored zoom", () => {
    expect(
      getInitialZoom({
        queryZoom: undefined,
        hasQueryLocation: false,
        storedZoom: 5,
      }),
    ).toBe(5);
  });
});

describe("MAP_DEFAULT_THEME", () => {
  it("is dark for visitors who haven't picked a theme", () => {
    expect(MAP_DEFAULT_THEME).toBe("dark");
  });
});
