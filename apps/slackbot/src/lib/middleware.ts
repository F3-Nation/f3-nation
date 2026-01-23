import type { AnyMiddlewareArgs, Middleware } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { api } from "./api-client";
import { logger } from "./logger";
import type { OrgSettings, SlackUserData } from "../types";
import { extractTeamId, extractUserId } from "../types/bolt-types";
import type { ExtendedContext } from "../types/bolt-types";

// The api-client methods are properly typed, but ESLint's @typescript-eslint/no-unsafe-*
// rules don't always infer nested object method types correctly. The types are verified
// in api-client.ts with explicit return type annotations.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

/**
 * Middleware to load org settings and user data for the current team.
 *
 * This middleware:
 * 1. Loads or creates the Slack space settings for the team
 * 2. Fetches the F3 org (region, area, etc.) associated with the Slack workspace
 * 3. Loads or creates the Slack user with a guaranteed linked F3 user
 * 4. Computes F3 role-based admin/editor permissions (not Slack's workspace admin)
 *
 * Results are cached to minimize API calls on repeated requests.
 */
export const withOrgContext: Middleware<AnyMiddlewareArgs> = async ({
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
    // Load or create space settings (cached)
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
      const settings = space.settings as unknown as OrgSettings;
      ctx.orgSettings = settings;

      // Fetch the org associated with this Slack workspace (cached)
      try {
        const orgResult = await api.slack.getOrg(teamId);
        if (orgResult?.org) {
          ctx.orgId = orgResult.org.id;
          ctx.orgType = orgResult.org.orgType;
        }
      } catch (error) {
        logger.warn(`Failed to fetch org for team ${teamId}:`, error);
      }
    }

    // Load or create user data if userId is available
    if (userId && typeof userId === "string") {
      try {
        // First, get user info from Slack to ensure we have the email
        const userInfo = await slackClient.users.info({ user: userId });

        if (userInfo.user) {
          const email = userInfo.user.profile?.email;

          if (!email) {
            // Cannot create linked user without email - log and continue without user context
            logger.warn(
              `Slack user ${userId} has no email address - cannot link to F3 user`,
            );
            await next();
            return;
          }

          // Get or create linked user (cached)
          // This ensures both SlackUser and F3 User exist and are linked
          const linkedUser = await api.slack.getOrCreateLinkedUser({
            slackId: userId,
            teamId,
            userName: userInfo.user.real_name ?? userInfo.user.name ?? userId,
            email,
            isAdmin: userInfo.user.is_admin ?? false,
            isOwner: userInfo.user.is_owner ?? false,
            isBot: userInfo.user.is_bot ?? false,
            avatarUrl: userInfo.user.profile?.image_512 ?? undefined,
          });

          // Fetch F3 role-based admin/editor status (cached)
          // This checks the rolesXUsersXOrg table, not Slack's admin/owner flags
          let isAdmin = false;
          let isEditor = false;

          try {
            const userRoles = await api.slack.getUserRoles(userId, teamId);
            isAdmin = userRoles.isAdmin ?? false;
            isEditor = userRoles.isEditor ?? false;

            if (userRoles.roles.length > 0) {
              logger.debug(
                `User ${userId} has F3 roles: ${userRoles.roles.map((r) => `${r.roleName}@${r.orgName}`).join(", ")}`,
              );
            }
          } catch (error) {
            logger.warn(`Failed to fetch F3 roles for user ${userId}:`, error);
            // Fall back to no admin/editor permissions on error
          }

          // Build the SlackUserData with F3 role-based permissions
          const userData: SlackUserData = {
            id: linkedUser.id,
            slackId: linkedUser.slackId,
            userName: linkedUser.userName,
            email: linkedUser.email,
            userId: linkedUser.userId, // Guaranteed to be present
            avatarUrl: linkedUser.avatarUrl ?? undefined,
            isAdmin, // F3 role-based, not Slack's is_admin
            isEditor, // F3 role-based
            isBot: linkedUser.isBot,
          };

          ctx.slackUser = userData;
        }
      } catch (error) {
        logger.warn(`Failed to fetch/create user info for ${userId}:`, error);
      }
    }
  } catch (error) {
    logger.error(`Error loading org context for team ${teamId}:`, error);
  }

  await next();
};

/**
 * @deprecated Use withOrgContext instead
 * Middleware to load region settings and user data for the current team.
 */
export const withRegionContext = withOrgContext;
