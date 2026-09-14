import { describe, it, expect } from "vitest";

import { InfoRequestGuard } from "./info-request-guard";

describe("InfoRequestGuard", () => {
  it("reports the current org and clears any prior location", () => {
    const guard = new InfoRequestGuard();
    guard.selectLocation(5);
    guard.selectOrg(10);
    expect(guard.isOrgCurrent(10)).toBe(true);
    expect(guard.isLocationCurrent(5)).toBe(false);
  });

  it("reports the current location and clears any prior org", () => {
    const guard = new InfoRequestGuard();
    guard.selectOrg(10);
    guard.selectLocation(5);
    expect(guard.isLocationCurrent(5)).toBe(true);
    expect(guard.isOrgCurrent(10)).toBe(false);
  });

  it("signals a switch only when selecting a different org", () => {
    const guard = new InfoRequestGuard();
    expect(guard.selectOrg(10)).toBe(true);
    expect(guard.selectOrg(10)).toBe(false);
    expect(guard.selectOrg(11)).toBe(true);
  });

  // Reproduction for the P2 "switching regions leaves stale details" bug:
  // a location request from region A must not populate the sidebar after the
  // map switches to region B's pins.
  it("invalidates a pending location request when pins switch to a new org", () => {
    const guard = new InfoRequestGuard();

    // Hovered a location pin in region A — its detail fetch is in flight.
    guard.selectLocation(5);
    expect(guard.isLocationCurrent(5)).toBe(true);

    // Clicked region B's polygon, which shows its pins (clearLocation).
    guard.clearLocation();

    // Region A's late-resolving fetch must no longer be allowed to render.
    expect(guard.isLocationCurrent(5)).toBe(false);
  });

  it("leaves the org selection intact when clearing the location", () => {
    const guard = new InfoRequestGuard();
    guard.selectOrg(10);
    guard.clearLocation();
    expect(guard.isOrgCurrent(10)).toBe(true);
  });
});
