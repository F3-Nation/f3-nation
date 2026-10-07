// The channels where dev-mode sign-in (a credentials provider that signs anyone
// in as a nation admin) is allowed. The single list behind both the server-side
// gate in @acme/auth and the map's Sign in (Dev Mode) button, so the button is
// offered exactly where the provider is registered.
//
// An allowlist, not `!== "prod"`: an unset or unknown channel must fail closed.
export const DEV_MODE_CHANNELS: ReadonlySet<string> = new Set([
  "local",
  "ci",
  "branch",
  "dev",
  "staging",
]);

export function isDevModeChannel(channel: string | undefined): boolean {
  return channel !== undefined && DEV_MODE_CHANNELS.has(channel);
}
