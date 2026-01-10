import type {
  AllMiddlewareArgs,
  AnyMiddlewareArgs,
  Context,
  SlackActionMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackEventMiddlewareArgs,
  SlackViewMiddlewareArgs,
} from "@slack/bolt";
import type {
  ActionsBlock,
  Button,
  KnownBlock,
  SectionBlock,
} from "@slack/web-api";

import type { RegionSettings, SlackUserData } from "./index";

/**
 * Extended context with region and user data
 */
export interface ExtendedContext extends Context {
  regionSettings?: RegionSettings;
  slackUser?: SlackUserData;
}

/**
 * Helper to extract team_id from any Bolt payload
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
export function extractTeamId(
  body: AnyMiddlewareArgs["body"],
): string | undefined {
  // Use localized disable for the complex union type extraction
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const b = body as any;
  if (b && typeof b === "object") {
    if ("team_id" in b && typeof b.team_id === "string") return b.team_id;
    if ("team" in b && b.team && typeof b.team === "object" && "id" in b.team)
      return b.team.id as string;
    if ("view" in b && b.view && "team_id" in b.view)
      return b.view.team_id as string;
    if ("event" in b && b.event && "team" in b.event)
      return b.event.team as string;
  }
  return undefined;
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

/**
 * Helper to extract user_id from any Bolt payload
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
export function extractUserId(
  body: AnyMiddlewareArgs["body"],
): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const b = body as any;
  if (b && typeof b === "object") {
    if ("user_id" in b && typeof b.user_id === "string") return b.user_id;
    if ("user" in b && b.user && typeof b.user === "object" && "id" in b.user)
      return b.user.id as string;
    if ("event" in b && b.event && "user" in b.event)
      return b.event.user as string;
  }
  return undefined;
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

export type TypedEventArgs<E extends string> = SlackEventMiddlewareArgs<E> &
  AllMiddlewareArgs<ExtendedContext>;

export type TypedActionArgs = SlackActionMiddlewareArgs &
  AllMiddlewareArgs<ExtendedContext>;

export type TypedCommandArgs = SlackCommandMiddlewareArgs &
  AllMiddlewareArgs<ExtendedContext>;

export type TypedViewArgs = SlackViewMiddlewareArgs &
  AllMiddlewareArgs<ExtendedContext>;

/**
 * Type-safe block array builder
 */
export type BlockList = KnownBlock[];

/**
 * Builder helpers that return typed blocks
 */
export const BlockBuilder = {
  actions: (elements: ActionsBlock["elements"]): ActionsBlock => ({
    type: "actions",
    elements,
  }),

  section: (text: string, mrkdwn = true): SectionBlock => ({
    type: "section",
    text: { type: mrkdwn ? "mrkdwn" : "plain_text", text },
  }),

  button: (text: string, actionId: string): Button => ({
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
  }),
};
