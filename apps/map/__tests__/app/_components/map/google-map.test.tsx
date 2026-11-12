/**
 * docs/specs/map-browse-and-search.md AC-19: once Google Maps rejects the API
 * key, `GoogleMapComponent` unmounts the map (Google has disabled its markers,
 * so any marker that mounts or moves afterwards throws) and shows the "Google
 * Maps isn't available" alert instead, never the app's error page.
 */

import type { ReactNode } from "react";
import { Component, useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LatLng {
  lat: number;
  lng: number;
}

const { fakeGoogle, runtimeConfig } = vi.hoisted(() => ({
  runtimeConfig: {
    current: { googleApiKey: "test-key", status: "ready" },
  },
  fakeGoogle: {
    markerClassDisabled: false,
    // Positions the fake marker accepted, in order.
    acceptedPositions: [] as LatLng[],
    // Position sets that threw because the marker class was disabled.
    rejectedPositionSets: 0,
    // When true, Google rejects the key as the next marker move commits.
    rejectOnNextMove: false,
  },
}));

// Google's disabled marker class throws from its own script, so the error's
// top frame is on maps.googleapis.com.
function disabledMarkerError(): TypeError {
  const error = new TypeError(
    "Cannot read properties of undefined (reading 'get')",
  );
  error.stack = `${error.name}: ${error.message}
    at _.Jn (https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js:212:39)
    at set position (https://maps.googleapis.com/maps-api-v3/api/js/66/13d/marker.js:111:207)`;
  return error;
}

/** Stands in for `google.maps.marker.AdvancedMarkerElement`. */
class FakeAdvancedMarkerElement {
  get position(): LatLng | undefined {
    return fakeGoogle.acceptedPositions.at(-1);
  }
  set position(value: LatLng) {
    if (fakeGoogle.markerClassDisabled) {
      fakeGoogle.rejectedPositionSets += 1;
      throw disabledMarkerError();
    }
    fakeGoogle.acceptedPositions.push(value);
  }
}

const markerElements: Record<string, FakeAdvancedMarkerElement> = {};

/**
 * Mirrors `AdvancedMarker` from `@vis.gl/react-google-maps`: it keeps one
 * marker element and assigns `position` to it in an effect whenever the prop
 * changes.
 */
const StubAdvancedMarker = ({
  id,
  position,
}: {
  id: string;
  position: LatLng;
}) => {
  useEffect(() => {
    markerElements[id] ??= new FakeAdvancedMarkerElement();
    markerElements[id].position = position;
  }, [id, position]);
  return null;
};

/**
 * Google rejects the key in a task of its own, after React has committed a
 * marker move but before it runs that move's effects. Running this effect
 * just before the marker's reproduces that order: the class is disabled and
 * `gm_authFailure` has fired by the time the marker sets its position.
 */
const GoogleRejectsKeyOnMove = ({ position }: { position: LatLng }) => {
  useEffect(() => {
    if (position === FIRST_POSITION || !fakeGoogle.rejectOnNextMove) return;
    fakeGoogle.markerClassDisabled = true;
    window.gm_authFailure?.();
  }, [position]);
  return null;
};

const FIRST_POSITION: LatLng = { lat: 30.27, lng: -97.74 };
const SECOND_POSITION: LatLng = { lat: 30.28, lng: -97.75 };
const markerControls: { move?: (position: LatLng) => void } = {};

const StubClusteredMarkers = () => {
  const [position, setPosition] = useState(FIRST_POSITION);
  useEffect(() => {
    markerControls.move = setPosition;
    return () => {
      markerControls.move = undefined;
    };
  }, []);
  return (
    <>
      <GoogleRejectsKeyOnMove position={position} />
      <StubAdvancedMarker id="ao-1" position={position} />
    </>
  );
};

vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));
vi.mock("~/env", () => ({ env: {} }));

// Google's script never loads in jsdom: the provider and map render their
// children so the stub markers mount where the real ones would.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  ControlPosition: {},
  Map: ({ children }: { children: ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
}));
vi.mock("~/utils/runtime-config", () => ({
  useRuntimeConfig: () => runtimeConfig.current,
}));
vi.mock("~/app/_components/map/initial-location-provider", () => ({
  useInitialLocation: () => ({
    initialCenter: { lat: 0, lng: 0 },
    initialZoom: 3,
  }),
}));
vi.mock("~/utils/hooks/use-update-loc-search-params", () => ({
  useUpdateLocSearchParams: () => undefined,
}));
vi.mock("~/app/_components/map-event-listener", () => ({
  MapEventListener: () => null,
}));
vi.mock("~/app/_components/map-layout-items", () => ({
  MapLayoutItems: () => null,
}));
vi.mock("~/app/_components/marker-clusters/clustered-markers", () => ({
  ClusteredMarkers: () => <StubClusteredMarkers />,
}));
vi.mock("~/app/_components/map/place-result-icon-pane", () => ({
  PlaceResultIconPane: () => null,
}));
vi.mock("~/app/_components/map/update-pane", () => ({
  UpdatePane: () => null,
}));

/** Stands in for the app's error boundary, which shows the error page. */
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p>error page: {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

// The auth-failure state is module-level (Google reports a rejection once per
// page), so each test loads fresh copies of the modules.
async function renderMap() {
  vi.resetModules();
  const { GoogleMapComponent } =
    await import("~/app/_components/map/google-map");
  render(
    <AppErrorBoundary>
      <GoogleMapComponent />
    </AppErrorBoundary>,
  );
}

function moveMarker(position: LatLng) {
  const move = markerControls.move;
  if (!move) throw new Error("the stub markers are not mounted");
  act(() => move(position));
}

function expectAlertInsteadOfMap() {
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Google Maps isn't available right now",
  );
  expect(screen.queryByTestId("api-provider")).not.toBeInTheDocument();
  expect(screen.queryByText(/error page/)).not.toBeInTheDocument();
}

beforeEach(() => {
  delete window.gm_authFailure;
  runtimeConfig.current = { googleApiKey: "test-key", status: "ready" };
  fakeGoogle.markerClassDisabled = false;
  fakeGoogle.acceptedPositions = [];
  fakeGoogle.rejectedPositionSets = 0;
  fakeGoogle.rejectOnNextMove = false;
  for (const id of Object.keys(markerElements)) delete markerElements[id];
  // React logs every error a boundary catches.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete window.gm_authFailure;
  vi.restoreAllMocks();
});

describe("GoogleMapComponent", () => {
  it("renders the map and moves its markers while Google accepts the key", async () => {
    await renderMap();

    moveMarker(SECOND_POSITION);

    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fakeGoogle.acceptedPositions).toEqual([
      FIRST_POSITION,
      SECOND_POSITION,
    ]);
  });

  it("replaces the map with the alert once Google rejects the key", async () => {
    await renderMap();

    const handler = window.gm_authFailure;
    if (!handler) throw new Error("gm_authFailure was not installed");
    act(() => handler());

    expectAlertInsteadOfMap();
  });

  it("shows the alert, not the error page, when a marker moves as Google rejects the key", async () => {
    await renderMap();
    fakeGoogle.rejectOnNextMove = true;

    moveMarker(SECOND_POSITION);

    expect(fakeGoogle.rejectedPositionSets).toBe(1);
    expect(fakeGoogle.acceptedPositions).toEqual([FIRST_POSITION]);
    expectAlertInsteadOfMap();
  });

  it("shows the config-error alert when runtime config fails to load", async () => {
    runtimeConfig.current = { googleApiKey: "", status: "error" };

    await renderMap();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't load the map right now",
    );
    expect(screen.queryByTestId("api-provider")).not.toBeInTheDocument();
  });

  it("shows a spinner and no alert while runtime config is loading", async () => {
    runtimeConfig.current = { googleApiKey: "", status: "loading" };

    await renderMap();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("api-provider")).not.toBeInTheDocument();
  });
});
