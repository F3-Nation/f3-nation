import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserLocationProvider } from "~/app/_components/map/user-location-provider";
import { mapStore } from "~/utils/store/map";

const { setView } = vi.hoisted(() => ({ setView: vi.fn() }));
vi.mock("~/utils/set-view", () => ({ setView }));

const position = { coords: { latitude: 36.2, longitude: -81.66 } };

describe("UserLocationProvider first jump", () => {
  beforeEach(() => {
    setView.mockReset();
    mapStore.setState({
      userGpsLocation: null,
      didSetQueryParamLocation: false,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: typeof position) => void) => ok(position),
      },
    });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  const firstJumpZoom = async (url: string) => {
    window.history.replaceState(null, "", url);
    render(
      <UserLocationProvider>
        <div />
      </UserLocationProvider>,
    );
    await waitFor(() => expect(setView).toHaveBeenCalled());
    return (setView.mock.calls[0]?.[0] as { zoom?: number }).zoom;
  };

  it("opens at USER_LOCATION_ZOOM when the URL has no zoom", async () => {
    expect(await firstJumpZoom("/")).toBe(10);
  });

  it("uses the embed's zoom param", async () => {
    expect(await firstJumpZoom("/?zoom=8")).toBe(8);
  });

  it("ignores a zoom the map writes into the URL before location resolves", async () => {
    let resolvePosition: (p: typeof position) => void = () => undefined;
    const getCurrentPosition = vi.fn((ok: (p: typeof position) => void) => {
      resolvePosition = ok;
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    window.history.replaceState(null, "", "/");
    render(
      <UserLocationProvider>
        <div />
      </UserLocationProvider>,
    );
    // The map's own URL sync runs while geolocation is still pending
    window.history.replaceState(null, "", "/?lat=36.2&lng=-81.66&zoom=15");
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
    resolvePosition(position);
    await waitFor(() => expect(setView).toHaveBeenCalled());
    expect((setView.mock.calls[0]?.[0] as { zoom?: number }).zoom).toBe(10);
  });
});
