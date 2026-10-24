/**
 * Deploy channel of this static export.
 *
 * Read from `NEXT_PUBLIC_CHANNEL` (the repo-wide channel vocabulary, see
 * apps/api/src/env.ts). Because the site is a static export, Next.js inlines
 * the value into the bundle at build time — there is no runtime to read it.
 *
 * Only `"staging"` (any case, surrounding whitespace ignored) changes anything. Every other value — unset, `"prod"`, and
 * also `"ci"`/`"local"`/... (CI sets `NEXT_PUBLIC_CHANNEL=ci` globally) — keeps
 * the production build exactly as it was, so the GitHub Pages deploy, which
 * never sets the variable, is unaffected.
 */
export type HomepageChannel = "prod" | "staging";

export function getChannel(
  value: string | undefined = process.env.NEXT_PUBLIC_CHANNEL,
): HomepageChannel {
  return value?.trim().toLowerCase() === "staging" ? "staging" : "prod";
}

interface ChannelHosts {
  /** Origin this homepage is served from (org/status pages live under it). */
  site: string;
  /** Default API base when NEXT_PUBLIC_API_URL is not set. */
  api: string;
}

export const CHANNEL_HOSTS: Record<HomepageChannel, ChannelHosts> = {
  prod: {
    site: "https://apps.f3nation.com",
    api: "https://api.f3nation.com",
  },
  staging: {
    site: "https://staging.apps.f3nation.com",
    api: "https://staging.api.f3nation.com",
  },
};

export function getSiteOrigin(channel: HomepageChannel = getChannel()): string {
  return CHANNEL_HOSTS[channel].site;
}

export function getDefaultApiBase(
  channel: HomepageChannel = getChannel(),
): string {
  return CHANNEL_HOSTS[channel].api;
}
