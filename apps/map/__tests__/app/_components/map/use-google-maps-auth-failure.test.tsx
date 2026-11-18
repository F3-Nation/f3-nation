/**
 * When Google Maps rejects the API key it disables its marker class, so every
 * marker the map mounts or moves afterwards throws. The map unmounts on the
 * signal this hook exposes; these tests pin that the signal fires from
 * Google's `gm_authFailure` callback, survives a remount, keeps any handler
 * already on `window` (reporting its throws as uncaught errors), and is
 * reported to PostHog once.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureException, env } = vi.hoisted(() => {
  const env: { NEXT_PUBLIC_POSTHOG_KEY?: string } = {
    NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
  };
  return { captureException: vi.fn(), env };
});

vi.mock("posthog-js", () => ({ default: { captureException } }));
vi.mock("~/env", () => ({ env }));

// The hook keeps module-level state (Google reports a rejection once per
// page), so each test loads a fresh copy of the module.
async function loadHook() {
  vi.resetModules();
  const mod =
    await import("~/app/_components/map/use-google-maps-auth-failure");
  return mod.useGoogleMapsAuthFailed;
}

function fireAuthFailure() {
  const handler = window.gm_authFailure;
  if (!handler) throw new Error("gm_authFailure was not installed");
  act(() => handler());
}

beforeEach(() => {
  captureException.mockReset();
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  delete window.gm_authFailure;
});

afterEach(() => {
  delete window.gm_authFailure;
  vi.unstubAllGlobals();
});

describe("useGoogleMapsAuthFailed", () => {
  it("is false until Google calls gm_authFailure, then true", async () => {
    const useGoogleMapsAuthFailed = await loadHook();
    const { result } = renderHook(() => useGoogleMapsAuthFailed());

    expect(result.current).toBe(false);
    expect(captureException).not.toHaveBeenCalled();

    fireAuthFailure();

    expect(result.current).toBe(true);
  });

  it("stays true for a map that mounts after the failure", async () => {
    const useGoogleMapsAuthFailed = await loadHook();
    const first = renderHook(() => useGoogleMapsAuthFailed());
    fireAuthFailure();
    first.unmount();

    const remounted = renderHook(() => useGoogleMapsAuthFailed());

    expect(remounted.result.current).toBe(true);
  });

  it("reports the failure to PostHog once, with a stable event name", async () => {
    const useGoogleMapsAuthFailed = await loadHook();
    renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();
    fireAuthFailure();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Google Maps rejected the API key (gm_authFailure)",
      }),
      { event: "map.google_maps.auth_failure" },
    );
  });

  it("does not report when PostHog is not configured", async () => {
    env.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    const useGoogleMapsAuthFailed = await loadHook();
    const { result } = renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();

    expect(result.current).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("still unmounts the map when reporting throws", async () => {
    captureException.mockImplementation(() => {
      throw new Error("ingest host blocked");
    });
    const useGoogleMapsAuthFailed = await loadHook();
    const { result } = renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();

    expect(result.current).toBe(true);
  });

  it("keeps calling a gm_authFailure handler that was already defined", async () => {
    const existing = vi.fn();
    window.gm_authFailure = existing;
    const useGoogleMapsAuthFailed = await loadHook();
    renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();

    expect(existing).toHaveBeenCalledTimes(1);
  });

  it("hands an existing gm_authFailure handler's throw to reportError and still unmounts the map", async () => {
    const thrown = new Error("third-party handler failed");
    window.gm_authFailure = () => {
      throw thrown;
    };
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const useGoogleMapsAuthFailed = await loadHook();
    const { result } = renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();

    expect(reportError).toHaveBeenCalledExactlyOnceWith(thrown);
    expect(result.current).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("still unmounts the map when an existing handler throws in a browser without reportError", async () => {
    expect("reportError" in window).toBe(false);
    window.gm_authFailure = () => {
      throw new Error("third-party handler failed");
    };
    const useGoogleMapsAuthFailed = await loadHook();
    const { result } = renderHook(() => useGoogleMapsAuthFailed());

    fireAuthFailure();

    expect(result.current).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
