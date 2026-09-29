interface DevModeSignInVisibility {
  /** Build-time `NEXT_PUBLIC_CHANNEL === "prod"`. */
  isProd: boolean;
  /** Build-time `NODE_ENV === "development"` (i.e. `next dev`). */
  isDevelopment: boolean;
  /** Runtime channel from /api/runtime-config. */
  channel: string;
  /** The debug toggle (12 clicks on the channel label). */
  showDebug: boolean;
}

/**
 * Whether the Settings modal offers "Sign in (Dev Mode)". Never in prod.
 * Otherwise in local dev, on per-PR previews — production builds, so
 * `isDevelopment` is false there, but the server registers the dev-mode
 * provider on the `branch` channel and the regular email sign-in can't
 * deliver mail — or when debug is on.
 */
export function shouldShowDevModeSignIn({
  isProd,
  isDevelopment,
  channel,
  showDebug,
}: DevModeSignInVisibility): boolean {
  if (isProd) return false;
  return isDevelopment || channel === "branch" || showDebug;
}
