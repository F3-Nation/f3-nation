/**
 * The boundary only swallows errors once Google Maps has rejected the key;
 * any other error must still reach the app's error boundary, or a real map
 * crash would show the "Google Maps isn't available" message and go
 * unreported.
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

const Throws = (): ReactNode => {
  throw new TypeError("Cannot read properties of undefined (reading 'get')");
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

  it("shows the fallback for an error after Google rejected the key", () => {
    authFailed.current = true;

    render(
      <Outer>
        <GoogleMapsAuthFailureBoundary fallback={<p>maps unavailable</p>}>
          <Throws />
        </GoogleMapsAuthFailureBoundary>
      </Outer>,
    );

    expect(screen.getByText("maps unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/outer caught/)).not.toBeInTheDocument();
  });

  it("re-throws to the outer boundary when the key was not rejected", () => {
    render(
      <Outer>
        <GoogleMapsAuthFailureBoundary fallback={<p>maps unavailable</p>}>
          <Throws />
        </GoogleMapsAuthFailureBoundary>
      </Outer>,
    );

    expect(
      screen.getByText(
        "outer caught: Cannot read properties of undefined (reading 'get')",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("maps unavailable")).not.toBeInTheDocument();
  });
});
