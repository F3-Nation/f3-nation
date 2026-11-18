"use client";

import type { ReactNode } from "react";
import { Component } from "react";

import { isGoogleMapsAuthFailed } from "./use-google-maps-auth-failure";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  error: unknown;
  hasError: boolean;
}

const GOOGLE_MAPS_SCRIPT_ORIGIN = "https://maps.googleapis.com/";

/**
 * True for the `TypeError`s Google's disabled marker class throws: their top
 * stack frame is in a script served from Google Maps. Chrome, Firefox and
 * Safari all print a frame's script URL. Chrome starts the stack with the
 * `TypeError: <message>` line, which is removed first so a URL inside the
 * message is never taken for a frame; after that, the first URL in the stack
 * is the top frame's. An error without a stack doesn't match, so it reaches
 * the app's error boundary rather than being hidden.
 */
function isGoogleMapsScriptError(error: unknown): boolean {
  if (!(error instanceof TypeError) || typeof error.stack !== "string") {
    return false;
  }
  const header = String(error);
  const frames = error.stack.startsWith(header)
    ? error.stack.slice(header.length)
    : error.stack;
  const topFrameUrl = /https?:\/\/[^\s)]+/.exec(frames)?.[0];
  return topFrameUrl?.startsWith(GOOGLE_MAPS_SCRIPT_ORIGIN) ?? false;
}

/**
 * Catches the marker errors that slip past `useGoogleMapsAuthFailed`.
 *
 * Google disables its marker class and calls `gm_authFailure` in the same
 * task, but React flushes effects it had already queued before it re-renders
 * on the new state, so a marker mounting or moving in that window still
 * throws. When the key was rejected and the error comes from Google's own
 * script, the boundary shows `fallback` (the failure is reported once by the
 * hook). Any other error, including one from our own code after a rejection,
 * is re-thrown to the app's error boundary unchanged so it is still reported.
 */
export class GoogleMapsAuthFailureBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (isGoogleMapsAuthFailed() && isGoogleMapsScriptError(this.state.error)) {
      return this.props.fallback;
    }
    throw this.state.error;
  }
}
