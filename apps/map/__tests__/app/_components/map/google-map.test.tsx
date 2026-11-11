/**
 * docs/specs/map-browse-and-search.md AC-19: once Google Maps rejects the API
 * key, `GoogleMapComponent` unmounts the map (Google has disabled its markers,
 * so any marker that mounts or moves afterwards throws) and shows the "Google
 * Maps isn't available" alert instead.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));
vi.mock("~/env", () => ({ env: {} }));

// The map itself needs Google's script; a stub stands in for everything under
// APIProvider so the test sees only whether it is mounted.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: () => <div data-testid="api-provider" />,
  ControlPosition: {},
  Map: () => null,
}));
vi.mock("~/utils/runtime-config", () => ({
  useRuntimeConfig: () => ({ googleApiKey: "test-key", status: "ready" }),
}));
vi.mock("~/app/_components/map/initial-location-provider", () => ({
  useInitialLocation: () => ({
    initialCenter: { lat: 0, lng: 0 },
    initialZoom: 3,
  }),
}));
vi.mock("~/app/_components/map-event-listener", () => ({
  MapEventListener: () => null,
}));
vi.mock("~/app/_components/map-layout-items", () => ({
  MapLayoutItems: () => null,
}));
vi.mock("~/app/_components/marker-clusters/clustered-markers", () => ({
  ClusteredMarkers: () => null,
}));
vi.mock("~/app/_components/map/place-result-icon-pane", () => ({
  PlaceResultIconPane: () => null,
}));
vi.mock("~/app/_components/map/update-pane", () => ({
  UpdatePane: () => null,
}));

// The auth-failure state is module-level (Google reports a rejection once per
// page), so each test loads fresh copies of the modules.
async function loadComponent() {
  vi.resetModules();
  const mod = await import("~/app/_components/map/google-map");
  return mod.GoogleMapComponent;
}

beforeEach(() => {
  delete window.gm_authFailure;
});

afterEach(() => {
  delete window.gm_authFailure;
});

describe("GoogleMapComponent", () => {
  it("renders the map while Google accepts the key", async () => {
    const GoogleMapComponent = await loadComponent();
    render(<GoogleMapComponent />);

    expect(screen.getByTestId("api-provider")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the map with the alert once Google rejects the key", async () => {
    const GoogleMapComponent = await loadComponent();
    render(<GoogleMapComponent />);

    const handler = window.gm_authFailure;
    if (!handler) throw new Error("gm_authFailure was not installed");
    act(() => handler());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google Maps isn't available right now",
    );
    expect(screen.queryByTestId("api-provider")).not.toBeInTheDocument();
  });
});
