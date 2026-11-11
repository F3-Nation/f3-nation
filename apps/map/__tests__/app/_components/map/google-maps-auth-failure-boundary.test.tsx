/**
 * The boundary only swallows the errors Google's disabled marker class throws
 * after it has rejected the key. Any other error, before or after a
 * rejection, must still reach the app's error boundary, or a real map crash
 * would show the "Google Maps isn't available" message and go unreported.
 */

import type { ReactNode } from "react";
import { Component } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authFailed } = vi.hoisted(() => ({ authFailed: { current: false } }));

vi.mock("~/app/_components/map/use-google-maps-auth-failure", () => ({
  isGoogleMapsAuthFailed: () => authFailed.current,
}));

const { GoogleMapsAuthFailureBoundary } =
  await import("~/app/_components/map/google-maps-auth-failure-boundary");

const GOOGLE_MESSAGE = "Cannot read properties of undefined (reading 'get')";

// Stacks as each engine prints them for Google's disabled marker class.
const CHROME_GOOGLE_STACK = `TypeError: ${GOOGLE_MESSAGE}
    at _.xm (https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js:212:39)
    at set map (https://maps.googleapis.com/maps-api-v3/api/js/66/13d/marker.js:111:207)
    at useAdvancedMarker.useEffect (http://localhost:3000/_next/static/chunks/map.js:10:5)`;
const FIREFOX_GOOGLE_STACK = `_.xm@https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js:212:39
set map@https://maps.googleapis.com/maps-api-v3/api/js/66/13d/marker.js:111:207
useAdvancedMarker/<@http://localhost:3000/_next/static/chunks/map.js:10:5`;
// Our own code on top, even with Google's script further down the stack.
const APP_STACK = `TypeError: ${GOOGLE_MESSAGE}
    at FeatureMarker (http://localhost:3000/_next/static/chunks/map.js:42:7)
    at _.xm (https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js:212:39)`;

function typeErrorWithStack(stack: string | undefined): TypeError {
  const error = new TypeError(GOOGLE_MESSAGE);
  error.stack = stack;
  return error;
}

const ThrowsError = ({ error }: { error: unknown }): ReactNode => {
  throw error;
};

class Outer extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p>outer caught: {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

function renderBoundaryThrowing(error: unknown) {
  render(
    <Outer>
      <GoogleMapsAuthFailureBoundary fallback={<p>maps unavailable</p>}>
        <ThrowsError error={error} />
      </GoogleMapsAuthFailureBoundary>
    </Outer>,
  );
}

function expectOuterCaught(message: string) {
  expect(screen.getByText(`outer caught: ${message}`)).toBeInTheDocument();
  expect(screen.queryByText("maps unavailable")).not.toBeInTheDocument();
}

beforeEach(() => {
  authFailed.current = false;
  // React logs every error a boundary catches.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GoogleMapsAuthFailureBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <GoogleMapsAuthFailureBoundary fallback={<p>maps unavailable</p>}>
        <p>the map</p>
      </GoogleMapsAuthFailureBoundary>,
    );

    expect(screen.getByText("the map")).toBeInTheDocument();
  });

  it.each([
    ["Chrome", CHROME_GOOGLE_STACK],
    ["Firefox and Safari", FIREFOX_GOOGLE_STACK],
  ])(
    "shows the fallback for a Google marker error after the key was rejected (%s stack)",
    (_engine, stack) => {
      authFailed.current = true;

      renderBoundaryThrowing(typeErrorWithStack(stack));

      expect(screen.getByText("maps unavailable")).toBeInTheDocument();
      expect(screen.queryByText(/outer caught/)).not.toBeInTheDocument();
    },
  );

  it("re-throws a Google marker error when the key was not rejected", () => {
    renderBoundaryThrowing(typeErrorWithStack(CHROME_GOOGLE_STACK));

    expectOuterCaught(GOOGLE_MESSAGE);
  });

  it("re-throws an error from our own code after the key was rejected", () => {
    authFailed.current = true;

    renderBoundaryThrowing(new Error("FeatureMarker: missing location"));

    expectOuterCaught("FeatureMarker: missing location");
  });

  it("re-throws a TypeError whose top frame is our code after the key was rejected", () => {
    authFailed.current = true;

    renderBoundaryThrowing(typeErrorWithStack(APP_STACK));

    expectOuterCaught(GOOGLE_MESSAGE);
  });

  it("re-throws a TypeError without a stack after the key was rejected", () => {
    authFailed.current = true;

    renderBoundaryThrowing(typeErrorWithStack(undefined));

    expectOuterCaught(GOOGLE_MESSAGE);
  });
});
