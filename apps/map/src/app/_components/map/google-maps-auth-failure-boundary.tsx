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

/**
 * Catches the marker errors that slip past `useGoogleMapsAuthFailed`.
 *
 * Google disables its marker class and calls `gm_authFailure` in the same
 * task, but React flushes effects it had already queued before it re-renders
 * on the new state, so a marker mounting or moving in that window still
 * throws. When the key was rejected, those errors are expected and the
 * boundary shows `fallback` (the failure is reported once by the hook).
 * Any other error is re-thrown to the app's error boundary unchanged.
 */
export class GoogleMapsAuthFailureBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (isGoogleMapsAuthFailed()) return this.props.fallback;
    throw this.state.error;
  }
}
