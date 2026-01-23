import type { AnyMiddlewareArgs, Middleware } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { api } from "./api-client";
import { logger } from "./logger";
import type { RegionSettings, SlackUserData } from "../types";
import type { GetUserRolesResponse, UserRoleEntry } from "../types/api-types";
import { extractTeamId, extractUserId } from "../types/bolt-types";
import type { ExtendedContext } from "../types/bolt-types";

/**
 * Middleware to load region settings and user data for the current team.
 *
 * For user admin/editor status, this middleware checks the F3 role system
 * (rolesXUsersXOrg table) rather than Slack's workspace admin/owner flags.
 * This ensures consistent permissions across the F3 ecosystem.
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

      // Fetch the region org ID associated with this Slack workspace
      try {
        const region = await api.slack.getRegion(teamId);
        if (region?.org) {
          ctx.regionOrgId = region.org.id;
        }
      } catch (error) {
        logger.warn(`Failed to fetch region org for team ${teamId}:`, error);
      }
    }

    // Load or create user data if userId is available
    if (userId && typeof userId === "string") {
      let slackUser = await api.slack.getUserBySlackId(userId, teamId);

      if (!slackUser) {
        logger.info(`User not found for ID ${userId}, creating...`);
        try {
          const userInfo = await slackClient.users.info({ user: userId });
          if (userInfo.user) {
            // Note: We still pass Slack's isAdmin/isOwner to getOrCreateUser for
            // the database record, but we'll compute the actual F3 role-based
            // admin status separately below.
            slackUser = await api.slack.getOrCreateUser({
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

      if (slackUser) {
        // Fetch F3 role-based admin/editor status from the role system
        // This replaces the Slack-based isAdmin/isOwner with F3's rolesXUsersXOrg
        let isAdmin = false;
        let isEditor = false;

        try {
          /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
          const userRoles: GetUserRolesResponse = await api.slack.getUserRoles(
            userId,
            teamId,
          );
          isAdmin = userRoles.isAdmin ?? false;
          isEditor = userRoles.isEditor ?? false;

          if (userRoles.roles.length > 0) {
            logger.debug(
              `User ${userId} has F3 roles: ${userRoles.roles.map((r: UserRoleEntry) => `${r.roleName}@${r.orgName}`).join(", ")}`,
            );
          }
          /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
        } catch (error) {
          logger.warn(`Failed to fetch F3 roles for user ${userId}:`, error);
          // Fall back to no admin/editor permissions on error
        }

        // Build the SlackUserData with F3 role-based permissions
        const userData: SlackUserData = {
          id: slackUser.id,
          slackId: slackUser.slackId,
          userName: slackUser.userName,
          email: slackUser.email ?? "",
          userId: slackUser.userId ?? undefined,
          avatarUrl: slackUser.avatarUrl ?? undefined,
          isAdmin, // F3 role-based, not Slack's is_admin
          isEditor, // F3 role-based
          isBot: slackUser.isBot ?? false,
        };

        ctx.slackUser = userData;
      }
    }
  } catch (error) {
    logger.error(`Error loading region context for team ${teamId}:`, error);
  }

  await next();
};
