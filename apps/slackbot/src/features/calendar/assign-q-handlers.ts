/**
 * Assign Q Form Handlers
 *
 * Handles the form submission for the Assign Q modal.
 */

import type { WebClient } from "@slack/web-api";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import {
  resolveSlackUserToUserId,
  resolveSlackUsersToUserIds,
} from "../../lib/slack-user-resolver";
import type { ExtendedContext, TypedViewArgs } from "../../types/bolt-types";
import { extractAssignQValues, parseAssignQMetadata } from "./assign-q";

/**
 * Handle Assign Q form submission.
 * Assigns the selected user as Q and optional users as Co-Qs.
 */
export async function handleAssignQSubmit(args: TypedViewArgs): Promise<void> {
  const { ack, body, client, context, view } = args;

  const extContext = context as ExtendedContext;
  const teamId = extContext.teamId ?? "";
  const currentUserSlackId = body.user.id;
  const slackClient = client as unknown as WebClient;

  // Parse metadata
  const { navMetadata: _navMetadata, assignQ } = parseAssignQMetadata(
    view.private_metadata,
  );

  if (!assignQ) {
    logger.error("Missing assignQ metadata in form submission");
    await ack({
      response_action: "errors",
      errors: {
        q_user_block: "An error occurred. Please try again.",
      },
    });
    return;
  }

  const { eventInstanceId, eventInstanceName, eventInstanceDate } = assignQ;

  // Extract form values
  const values = view.state?.values ?? {};
  const { qSlackId, coQSlackIds } = extractAssignQValues(values);

  logger.info("Assign Q form submission", {
    eventInstanceId,
    qSlackId,
    coQSlackIds,
  });

  // Convert Slack IDs to user IDs using the resolver
  // This will fetch from Slack API and create/link users if they don't exist
  let qUserId: number | undefined;
  let coQUserIds: number[] = [];

  try {
    if (qSlackId) {
      const userId = await resolveSlackUserToUserId({
        client: slackClient,
        slackId: qSlackId,
        teamId,
      });
      if (userId) {
        qUserId = userId;
      } else {
        logger.warn("Failed to resolve Q user", { qSlackId });
      }
    }

    if (coQSlackIds.length > 0) {
      coQUserIds = await resolveSlackUsersToUserIds({
        client: slackClient,
        slackIds: coQSlackIds,
        teamId,
      });
    }
  } catch (error) {
    logger.error("Failed to resolve user IDs", { error });
    await ack({
      response_action: "errors",
      errors: {
        q_user_block: "Failed to find selected users. Please try again.",
      },
    });
    return;
  }

  try {
    // Use the single API call to assign Q and Co-Qs
    await api.attendance.assignQAndCoQs({
      eventInstanceId,
      qUserId,
      coQUserIds,
    });

    // Acknowledge the form submission
    await ack();

    // Send DMs to assigned users (if not the current user)
    if (qSlackId && qSlackId !== currentUserSlackId) {
      try {
        await client.chat.postMessage({
          channel: qSlackId,
          text: `<@${currentUserSlackId}> has assigned you to Q ${eventInstanceName} on ${eventInstanceDate}. Use the button below to set the preblast.`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<@${currentUserSlackId}> has assigned you to Q *${eventInstanceName}* on *${eventInstanceDate}*. Use the button below to set the preblast.`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: {
                    type: "plain_text",
                    text: "Fill Out Preblast",
                  },
                  style: "primary",
                  action_id: ACTIONS.MSG_EVENT_PREBLAST_BUTTON,
                  value: eventInstanceId.toString(),
                },
              ],
            },
          ],
        });
      } catch (error) {
        logger.warn("Failed to send DM to new Q", { error, qSlackId });
      }
    }

    for (const coQSlackId of coQSlackIds) {
      if (coQSlackId !== currentUserSlackId) {
        try {
          await client.chat.postMessage({
            channel: coQSlackId,
            text: `<@${currentUserSlackId}> has assigned you to Co-Q ${eventInstanceName} on ${eventInstanceDate}.`,
          });
        } catch (error) {
          logger.warn("Failed to send DM to Co-Q", { error, coQSlackId });
        }
      }
    }

    logger.info("Successfully assigned Q/Co-Qs", {
      eventInstanceId,
      qUserId,
      coQUserIds,
    });
  } catch (error) {
    logger.error("Failed to assign Q/Co-Qs", { error });
    await ack({
      response_action: "errors",
      errors: {
        q_user_block: "Failed to assign Q. Please try again.",
      },
    });
  }
}
