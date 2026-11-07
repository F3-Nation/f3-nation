import { describe, expect, it } from "vitest";

import { USER_LOCATION_ZOOM } from "@acme/shared/app/constants";

import { getUserLocationZoom } from "~/utils/user-location-zoom";

describe("getUserLocationZoom", () => {
  it("opens at about a 25-30 mile radius by default", () => {
    expect(USER_LOCATION_ZOOM).toBe(10);
    expect(getUserLocationZoom("")).toBe(10);
  });

  it("uses the zoom query param when an embed sets one", () => {
    expect(getUserLocationZoom("?zoom=8")).toBe(8);
    expect(getUserLocationZoom("?auto=yes&zoom=11.5")).toBe(11.5);
  });

  it("ignores a zoom param that is not a number", () => {
    expect(getUserLocationZoom("?zoom=close")).toBe(10);
  });
});
