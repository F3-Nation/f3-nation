/**
 * Slack User Resolver
 *
 * Utility to resolve Slack user IDs to linked F3 users.
 * Follows the same flow as middleware.ts:
 * 1. Check cache/DB for existing user
 * 2. If not found, fetch from Slack API
 * 3. Save to slack_user table and link to F3 user
 *
 * This is used anywhere users are tagged in forms (e.g., Assign Q, attendance).
 */

import type { WebClient } from "@slack/web-api";
import { api } from "./api-client";
import { logger } from "./logger";
import type { LinkedSlackUserResponse } from "../types/api-types";

export interface ResolvedUser {
  slackId: string;
  userId: number;
  userName: string;
  email: string;
  avatarUrl?: string;
  isBot: boolean;
}

export interface ResolveUserOptions {
  /** The Slack WebClient instance */
  client: WebClient;
  /** The Slack user ID to resolve */
  slackId: string;
  /** The Slack team ID */
  teamId: string;
}

export interface ResolveManyUsersOptions {
  /** The Slack WebClient instance */
  client: WebClient;
  /** The Slack user IDs to resolve */
  slackIds: string[];
  /** The Slack team ID */
  teamId: string;
}

export interface ResolveManyUsersResult {
  /** Successfully resolved users */
  resolved: ResolvedUser[];
  /** Slack IDs that failed to resolve */
  failed: string[];
}

/**
 * Resolve a Slack user ID to a linked F3 user.
 *
 * This function:
 * 1. Checks the cache/DB for an existing linked user
 * 2. If not found, fetches user info from Slack API
 * 3. Creates/links the user via getOrCreateLinkedUser
 *
 * @returns The resolved user with guaranteed F3 userId, or null if resolution failed
 */
export async function resolveSlackUser(
  options: ResolveUserOptions,
): Promise<ResolvedUser | null> {
  const { client, slackId, teamId } = options;

  try {
    // First, check if user already exists in cache/DB
    const existingUser = await api.slack.getUserBySlackId(slackId, teamId);

    if (existingUser?.email && existingUser?.userId) {
      // User exists with email and F3 link - use cached data
      logger.debug(`Resolved user from cache/DB: ${slackId}`);
      return {
        slackId: existingUser.slackId,
        userId: existingUser.userId,
        userName: existingUser.userName,
        email: existingUser.email,
        avatarUrl: existingUser.avatarUrl ?? undefined,
        isBot: existingUser.isBot,
      };
    }

    // User doesn't exist or missing required fields - fetch from Slack API
    logger.debug(`Fetching user info from Slack API for ${slackId}`);
    const userInfo = await client.users.info({ user: slackId });

    if (!userInfo.user) {
      logger.warn(`Slack API returned no user for ${slackId}`);
      return null;
    }

    // Use email if available, otherwise use slack_id@slack.local as fallback (for bots)
    const email = userInfo.user.profile?.email ?? `${slackId}@slack.local`;

    // Get or create linked user (this ensures both SlackUser and F3 User exist)
    const linkedUser: LinkedSlackUserResponse =
      await api.slack.getOrCreateLinkedUser({
        slackId,
        teamId,
        userName: userInfo.user.real_name ?? userInfo.user.name ?? slackId,
        email,
        isAdmin: userInfo.user.is_admin ?? false,
        isOwner: userInfo.user.is_owner ?? false,
        isBot: userInfo.user.is_bot ?? false,
        avatarUrl: userInfo.user.profile?.image_512 ?? undefined,
      });

    logger.debug(`Created/linked user from Slack API: ${slackId}`);
    return {
      slackId: linkedUser.slackId,
      userId: linkedUser.userId,
      userName: linkedUser.userName,
      email: linkedUser.email,
      avatarUrl: linkedUser.avatarUrl ?? undefined,
      isBot: linkedUser.isBot,
    };
  } catch (error) {
    logger.error(`Failed to resolve Slack user ${slackId}:`, error);
    return null;
  }
}

/**
 * Resolve multiple Slack user IDs to linked F3 users.
 *
 * This is more efficient for batch operations as it processes users in parallel.
 *
 * @returns Object with resolved users and any failed slack IDs
 */
export async function resolveSlackUsers(
  options: ResolveManyUsersOptions,
): Promise<ResolveManyUsersResult> {
  const { client, slackIds, teamId } = options;

  const results = await Promise.all(
    slackIds.map(async (slackId) => {
      const resolved = await resolveSlackUser({ client, slackId, teamId });
      return { slackId, resolved };
    }),
  );

  const resolved: ResolvedUser[] = [];
  const failed: string[] = [];

  for (const result of results) {
    if (result.resolved) {
      resolved.push(result.resolved);
    } else {
      failed.push(result.slackId);
    }
  }

  if (failed.length > 0) {
    logger.warn(`Failed to resolve ${failed.length} Slack users:`, failed);
  }

  return { resolved, failed };
}

/**
 * Resolve a Slack user ID to just the F3 user ID.
 *
 * Convenience wrapper when you only need the userId.
 *
 * @returns The F3 user ID, or null if resolution failed
 */
export async function resolveSlackUserToUserId(
  options: ResolveUserOptions,
): Promise<number | null> {
  const resolved = await resolveSlackUser(options);
  return resolved?.userId ?? null;
}

/**
 * Resolve multiple Slack user IDs to F3 user IDs.
 *
 * Convenience wrapper when you only need the userIds.
 *
 * @returns Array of F3 user IDs (excludes any that failed to resolve)
 */
export async function resolveSlackUsersToUserIds(
  options: ResolveManyUsersOptions,
): Promise<number[]> {
  const { resolved } = await resolveSlackUsers(options);
  return resolved.map((u) => u.userId);
}
