import type { AnyMiddlewareArgs, Middleware } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { api } from "./api-client";
import { logger } from "./logger";
import type { RegionSettings } from "../types";
import { extractTeamId, extractUserId } from "../types/bolt-types";
import type { ExtendedContext } from "../types/bolt-types";

/**
 * Middleware to load region settings and user data for the current team
 */
export const withRegionContext: Middleware<AnyMiddlewareArgs> = async ({
  context,
  body,
  client,
  next,
}) => {
  const ctx = context as ExtendedContext;
  const slackClient = client as unknown as WebClient;
  const teamId = extractTeamId(body);
  const userId = extractUserId(body);

  if (!teamId) {
    logger.debug("No teamId found in request body");
    await next();
    return;
  }

  try {
    // Load or create region settings
    let space = await api.slack.getSpace(teamId);

    if (!space) {
      logger.info(`Space not found for team ${teamId}, creating...`);
      let workspaceName: string | undefined;

      try {
        const teamInfo = await slackClient.team.info({ team: teamId });
        workspaceName = teamInfo.team?.name;
      } catch (error) {
        logger.warn(
          `Failed to fetch team info from Slack for ${teamId}:`,
          error,
        );
      }

      space = await api.slack.getOrCreateSpace({
        teamId,
        workspaceName,
      });
    }

    if (space) {
      ctx.regionSettings = space.settings as unknown as RegionSettings;
    }

    // Load or create user data if userId is available
    if (userId && typeof userId === "string") {
      let user = await api.slack.getUserBySlackId(userId, teamId);

      if (!user) {
        logger.info(`User not found for ID ${userId}, creating...`);
        try {
          const userInfo = await slackClient.users.info({ user: userId });
          if (userInfo.user) {
            user = await api.slack.getOrCreateUser({
              slackId: userId,
              teamId,
              userName: userInfo.user.real_name ?? userInfo.user.name ?? userId,
              email: userInfo.user.profile?.email ?? undefined,
              isAdmin: userInfo.user.is_admin ?? false,
              isOwner: userInfo.user.is_owner ?? false,
              isBot: userInfo.user.is_bot ?? false,
              avatarUrl: userInfo.user.profile?.image_512 ?? undefined,
            });
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch user info from Slack for ${userId}:`,
            error,
          );
        }
      }

      if (user) {
        ctx.slackUser = user;
      }
    }
  } catch (error) {
    logger.error(`Error loading region context for team ${teamId}:`, error);
  }

  await next();
};
