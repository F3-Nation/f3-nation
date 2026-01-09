import type { AnyMiddlewareArgs, Middleware } from "@slack/bolt";
import { api } from "./api-client";
import { logger } from "./logger";
import type { RegionSettings } from "../types";

/**
 * Middleware to load region settings and user data for the current team
 */
export const withRegionContext: Middleware<any> = async ({
  context,
  body,
  next,
}) => {
  const b = body;
  const teamId = b.team_id || b.team?.id || b.event?.team || b.view?.team_id;
  const userId = b.user_id || b.user?.id || b.event?.user || b.view?.user?.id;

  if (!teamId) {
    logger.debug("No teamId found in request body");
    await next();
    return;
  }

  try {
    // Load region settings
    const space = await api.slack.getSpace(teamId);
    if (space) {
      context.regionSettings = space.settings as unknown as RegionSettings;
    }

    // Load user data if userId is available
    if (userId && typeof userId === "string") {
      const user = await api.slack.getUserBySlackId(userId, teamId);
      if (user) {
        context.slackUser = user;
      }
    }
  } catch (error) {
    logger.error(`Error loading region context for team ${teamId}:`, error);
  }

  await next();
};
