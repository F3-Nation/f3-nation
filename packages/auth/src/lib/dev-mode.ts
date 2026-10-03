import { isDevModeChannel } from "@acme/shared/common/dev-mode";

/**
 * Whether the dev-mode credentials provider, which signs anyone in as a nation
 * admin, may be registered. It must never be registered in Production.
 *
 * Reads the server-only F3_CHANNEL, never NEXT_PUBLIC_CHANNEL: Next.js freezes
 * a NEXT_PUBLIC_* value into the server bundle when it is set at build time,
 * and the map image is built once and promoted unchanged from Staging to
 * Production.
 */
export function isDevModeSignInAllowed(
  channel: string | undefined = process.env.F3_CHANNEL,
): boolean {
  return isDevModeChannel(channel);
}
