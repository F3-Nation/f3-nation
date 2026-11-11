import { useSyncExternalStore } from "react";
import posthog from "posthog-js";

import { env } from "~/env";

declare global {
  interface Window {
    /**
     * Google Maps calls this global, if defined, when it rejects the API key
     * (invalid key, disallowed referrer, billing or quota problems).
     */
    gm_authFailure?: () => void;
  }
}

/**
 * When Google rejects the key, it also disables `AdvancedMarkerElement`: from
 * then on, creating a marker or setting its `position` or `map` throws
 * `TypeError`s from inside Google's code. Markers mounted or updated after
 * that crash the map, so callers stop rendering the map once this is true.
 *
 * `@vis.gl/react-google-maps` exposes an `AUTH_FAILURE` loading status but its
 * loader never sets it, so the failure is read from Google's own hook here.
 *
 * Google loads once per page and reports a rejection once, so the state is
 * module-level: a map that remounts after the failure still sees it.
 */
let authFailed = false;
let handlerInstalled = false;
const listeners = new Set<() => void>();

function reportAuthFailure() {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  // A throw from captureException (ingest host blocked by an ad blocker) must
  // not escape into Google's callback, or the map would never switch to its
  // fallback. Dropping this one report is the right trade.
  try {
    posthog.captureException(
      new Error("Google Maps rejected the API key (gm_authFailure)"),
      { event: "map.google_maps.auth_failure" },
    );
  } catch {
    // Swallowed deliberately, without console.error: this is ordinary app
    // code, not the error reporter's own failure path.
  }
}

function installHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  const previous = window.gm_authFailure;
  window.gm_authFailure = () => {
    // A throw from a handler defined elsewhere must not stop the map from
    // switching to its fallback, or its markers would crash the page.
    try {
      previous?.();
    } catch {
      // Swallowed deliberately: that handler's failure is its owner's concern.
    }
    if (authFailed) return;
    authFailed = true;
    reportAuthFailure();
    listeners.forEach((listener) => listener());
  };
}

function subscribe(listener: () => void) {
  installHandler();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Non-hook read of the same state, for error boundaries. Google flags the
 * failure in the same task that disables its marker class, so this is already
 * true when a marker effect queued earlier throws.
 */
export function isGoogleMapsAuthFailed(): boolean {
  return authFailed;
}

/** True once Google Maps has rejected the API key on this page. */
export function useGoogleMapsAuthFailed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => authFailed,
    () => false,
  );
}
