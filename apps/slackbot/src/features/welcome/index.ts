import type { App } from "@slack/bolt";
import { ACTIONS } from "../../constants/actions";
import { WELCOME_MESSAGE_TEMPLATES } from "../../constants/templates";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import type { RegionSettings } from "../../types";
import { extractTeamId, extractUserId } from "../../types/bolt-types";
import type { TypedEventArgs } from "../../types/bolt-types";

/**
 * Handle team_join event
 */
async function handleTeamJoin({
  event: _event,
  client,
  context,
  body,
}: TypedEventArgs<"team_join">) {
  const { regionSettings } = context;
  const userId = extractUserId(body);
  const teamId = extractTeamId(body);

  if (!userId) {
    logger.warn("Received team_join event without user ID");
    return;
  }

  if (!regionSettings) {
    logger.debug(
      `No region settings found for team ${teamId}, skipping welcome message`,
    );
    return;
  }

  try {
    // 1. Welcome DM
    if (
      regionSettings.welcome_dm_enable &&
      regionSettings.welcome_dm_template
    ) {
      // template could be a string or blocks
      let blocks = undefined;
      let text = "Welcome!";

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsed =
          typeof regionSettings.welcome_dm_template === "string"
            ? JSON.parse(regionSettings.welcome_dm_template)
            : regionSettings.welcome_dm_template;

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "type" in parsed &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          parsed.type === "rich_text"
        ) {
          blocks = [parsed];
        } else if (Array.isArray(parsed)) {
          blocks = parsed;
        } else {
          text = regionSettings.welcome_dm_template;
        }
      } catch (e) {
        text = regionSettings.welcome_dm_template;
      }

      await client.chat.postMessage({
        channel: userId,
        text,
        blocks,
      });
    }

    // 2. Welcome Channel Post
    if (
      regionSettings.welcome_channel_enable &&
      regionSettings.welcome_channel
    ) {
      const templates = WELCOME_MESSAGE_TEMPLATES;
      const template = templates[Math.floor(Math.random() * templates.length)];
      if (template) {
        const message = template
          .replace(/{user}/g, userId)
          .replace(/{region}/g, regionSettings.workspace_name ?? "the region");

        await client.chat.postMessage({
          channel: regionSettings.welcome_channel,
          text: message,
        });
      }
    }
  } catch (error) {
    logger.error("Error in handleTeamJoin:", error);
  }
}

/**
 * Register Welcome feature
 */
export function registerWelcomeFeature(app: App) {
  // Event handler
  app.event("team_join", handleTeamJoin);

  // Action handler for saving settings
  app.view(
    ACTIONS.WELCOME_SAVE,
    async ({ ack, view, body, client: _client }) => {
      await ack();

      const teamId = body.team?.id;
      if (!teamId) return;

      const values = view.state.values;
      const dmEnable =
        values[ACTIONS.WELCOME_DM_ENABLE]?.[ACTIONS.WELCOME_DM_ENABLE]
          ?.selected_option?.value === "enable";
      const dmTemplate =
        values[ACTIONS.WELCOME_DM_TEMPLATE]?.[ACTIONS.WELCOME_DM_TEMPLATE]
          ?.rich_text_value;
      const channelEnable =
        values[ACTIONS.WELCOME_CHANNEL_ENABLE]?.[ACTIONS.WELCOME_CHANNEL_ENABLE]
          ?.selected_option?.value === "enable";
      const channel =
        values[ACTIONS.WELCOME_CHANNEL]?.[ACTIONS.WELCOME_CHANNEL]
          ?.selected_channel;

      try {
        await api.slack.updateSpaceSettings(teamId, {
          welcome_dm_enable: dmEnable,
          welcome_dm_template: JSON.stringify(dmTemplate),
          welcome_channel_enable: channelEnable,
          welcome_channel: channel ?? undefined,
        });

        logger.info(`Updated welcome settings for team ${teamId}`);
      } catch (error) {
        logger.error("Error saving welcome settings:", error);
      }
    },
  );
}

/**
 * Build Welcome Config Modal
 */
export function buildWelcomeConfigModal(regionSettings?: RegionSettings) {
  return {
    type: "modal" as const,
    callback_id: ACTIONS.WELCOME_SAVE,
    title: { type: "plain_text" as const, text: "Welcomebot Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: ACTIONS.WELCOME_DM_ENABLE,
        label: { type: "plain_text", text: "Enable Welcomebot welcome DMs?" },
        element: {
          type: "radio_buttons",
          action_id: ACTIONS.WELCOME_DM_ENABLE,
          initial_option: {
            text: {
              type: "plain_text",
              text: regionSettings?.welcome_dm_enable ? "Enable" : "Disable",
            },
            value: regionSettings?.welcome_dm_enable ? "enable" : "disable",
          },
          options: [
            { text: { type: "plain_text", text: "Enable" }, value: "enable" },
            { text: { type: "plain_text", text: "Disable" }, value: "disable" },
          ],
        },
      },
      {
        type: "input",
        block_id: ACTIONS.WELCOME_DM_TEMPLATE,
        label: { type: "plain_text", text: "Welcome Message Template" },
        optional: true,
        element: {
          type: "rich_text_input",
          action_id: ACTIONS.WELCOME_DM_TEMPLATE,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          initial_value: regionSettings?.welcome_dm_template
            ? JSON.parse(regionSettings.welcome_dm_template)
            : undefined,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "*This content will be sent to any new user who joins this Slack workspace.*\n\nThis is a good time to tell an FNG what they need to know.",
          },
        ],
      },
      {
        type: "input",
        block_id: ACTIONS.WELCOME_CHANNEL_ENABLE,
        label: {
          type: "plain_text",
          text: "Enable Welcomebot welcome channel posts?",
        },
        element: {
          type: "radio_buttons",
          action_id: ACTIONS.WELCOME_CHANNEL_ENABLE,
          initial_option: {
            text: {
              type: "plain_text",
              text: regionSettings?.welcome_channel_enable
                ? "Enable"
                : "Disable",
            },
            value: regionSettings?.welcome_channel_enable
              ? "enable"
              : "disable",
          },
          options: [
            { text: { type: "plain_text", text: "Enable" }, value: "enable" },
            { text: { type: "plain_text", text: "Disable" }, value: "disable" },
          ],
        },
      },
      {
        type: "input",
        block_id: ACTIONS.WELCOME_CHANNEL,
        label: { type: "plain_text", text: "Welcomebot Channel" },
        element: {
          type: "channels_select",
          action_id: ACTIONS.WELCOME_CHANNEL,
          initial_channel: regionSettings?.welcome_channel ?? undefined,
        },
      },
    ],
  };
}
