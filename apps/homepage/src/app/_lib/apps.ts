import type { HomepageChannel } from "./channel";
import { CHANNEL_HOSTS, getChannel } from "./channel";

/** App with a production URL — renders as a clickable card. */
interface NavigableApp {
  name: string;
  description: string;
  href: string;
  /** Local dev URL override; falls back to `href` when absent. */
  localHref?: string;
  /**
   * URL used by the staging build (NEXT_PUBLIC_CHANNEL=staging). Apps without
   * one have no staging site and are hidden from the staging build.
   */
  stagingHref?: string;
  /** Link button label. Defaults to "Open". */
  linkLabel?: string;
}

/** App with no link — renders as a non-clickable informational card in every build. */
interface InformationalApp {
  name: string;
  description: string;
  href?: never;
  linkLabel?: never;
}

export type App = NavigableApp | InformationalApp;

export interface AppGroup {
  title: string;
  description: string;
  /** At least one app is required — an empty group renders a heading with no cards. */
  apps: [App, ...App[]];
}

const PROD_SITE = CHANNEL_HOSTS.prod.site;
const STAGING_SITE = CHANNEL_HOSTS.staging.site;

export const APP_GROUPS: AppGroup[] = [
  {
    title: "Everyday Use",
    description:
      "Apps built for every PAX — find workouts, manage your profile, and explore the F3 ecosystem.",
    apps: [
      {
        name: "F3 Map",
        description:
          "Find F3 workouts near you. Browse every workout group across the nation on an interactive map.",
        href: "https://map.f3nation.com",
        localHref: "http://localhost:3000",
        stagingHref: "https://staging.map.f3nation.com",
      },
      {
        name: "F3 Near Me",
        description:
          "Lightweight, fast map for discovering F3 workout locations near you — no account needed.",
        href: "https://f3near.me",
      },
      {
        name: "F3 Me",
        description:
          "Your personal F3 profile. Update your avatar, manage emergency contacts, and control your info.",
        href: "https://me.f3nation.com",
        localHref: "http://localhost:3003",
        stagingHref: "https://staging.me.f3nation.com",
      },
      {
        name: "PAX Vault",
        description:
          "Analytics and reporting for F3 regions. Participation, leadership load, attendance trends — data over vibes.",
        href: "https://pax-vault.f3nation.com",
      },
      {
        name: "The Codex",
        description:
          "The F3 Exicon and Lexicon — a living, searchable repository of exercises and F3 terminology built by the community.",
        href: "https://codex.f3nation.com",
      },
      {
        name: "Org Chart",
        description:
          "Geographic digital directory visualizing F3's organizational structure — Sectors, Areas, and Regions on a map.",
        href: `${PROD_SITE}/org`,
        localHref: "http://localhost:3005/org",
        stagingHref: `${STAGING_SITE}/org`,
        linkLabel: "Open",
      },
    ],
  },
  {
    title: "Region Admins",
    description:
      "Tools for ITQs, region leaders, and anyone responsible for keeping a local F3 community running.",
    apps: [
      {
        name: "Admin",
        description:
          "Administrative portal for region and group leadership. Manage locations, events, and organization settings.",
        href: "https://admin.f3nation.com",
        localHref: "http://localhost:3002",
        stagingHref: "https://staging.admin.f3nation.com",
      },
      {
        name: "Region Pages",
        description:
          "Dedicated pages for F3 regions — workout calendars, member directories, event info, and contact details for each local community.",
        href: "https://regions.f3nation.com",
      },
      {
        name: "Slack Bot",
        description:
          "The primary way most PAX interact with F3 tech. Scheduling, attendance tracking, and region management — installed on 300+ workspaces.",
        href: "https://docs.google.com/document/d/1e7tmuY3irKDt9oy1URQVcxPwxyet1ZY_bVZhGvhESEw",
        linkLabel: "Learn More",
      },
      {
        name: "SyncBot",
        description:
          "Slack app for syncing channels and messages across multiple workspaces (threads, reactions, and media).",
        href: "https://github.com/F3-Nation/syncbot/blob/main/docs/USER_GUIDE.md",
        linkLabel: "Learn More",
      },
    ],
  },
  {
    title: "Developers",
    description:
      "Infrastructure and APIs for contributors building on or integrating with the F3 Nation platform.",
    apps: [
      {
        name: "Auth",
        description:
          "Shared SSO authentication powering F3 Nation apps. Secure, centralized sign-in for PAX across the ecosystem.",
      },
      {
        name: "API",
        description:
          "The F3 Nation data API. Unified backend powering the map, admin, and other apps — the single source of truth for F3 data.",
        href: CHANNEL_HOSTS.prod.api,
        localHref: "http://localhost:3001",
        stagingHref: CHANNEL_HOSTS.staging.api,
      },
      {
        name: "Status",
        description:
          "Real-time health and status for all F3 Nation services. Check if something's down or having issues.",
        href: `${PROD_SITE}/status/`,
        localHref: "http://localhost:3005/status",
        stagingHref: `${STAGING_SITE}/status/`,
      },
    ],
  },
];

/** A group as rendered for one channel; may hold fewer apps than its source. */
export interface ChannelAppGroup {
  title: string;
  description: string;
  apps: App[];
}

/**
 * The app directory for a channel. Prod returns the groups unchanged. Staging
 * swaps each link for its `stagingHref`, drops linked apps that have no
 * staging site (they would send testers to production), keeps informational
 * cards, and drops any group left empty.
 */
export function selectAppGroups(
  channel: HomepageChannel = getChannel(),
  groups: AppGroup[] = APP_GROUPS,
): ChannelAppGroup[] {
  if (channel === "prod") return groups;
  return groups
    .map((group) => ({
      ...group,
      apps: group.apps.flatMap((app): App[] => {
        if (app.href === undefined) return [app];
        if (!app.stagingHref) return [];
        return [{ ...app, href: app.stagingHref }];
      }),
    }))
    .filter((group) => group.apps.length > 0);
}

/** The link a card renders, or undefined for informational cards. */
export function resolveHref(app: App, isLocal: boolean): string | undefined {
  if (!app.href) return undefined;
  return isLocal ? (app.localHref ?? app.href) : app.href;
}
