/**
 * Help feature module
 *
 * Provides /help command and @mention handling.
 */

import type { App } from "@slack/bolt";
import type { ActionsBlock, Button, SectionBlock, View } from "@slack/web-api";

import { ACTIONS } from "../../constants/actions";
import { logger } from "../../lib/logger";

/**
 * Build the help modal view
 */
function buildHelpModal(): View {
  const buttonBlock: ActionsBlock = {
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "📅 Open Calendar",
          emoji: true,
        },
        action_id: ACTIONS.OPEN_CALENDAR_BUTTON,
      } satisfies Button,
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "📝 Create Preblast",
          emoji: true,
        },
        action_id: ACTIONS.PREBLAST_NEW_BUTTON,
      } satisfies Button,
    ],
  };

  const helpTextBlock: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Welcome to F3 Nation Slack Bot!* 🏋️

Here's what I can help you with:

• */help* - Show this help menu
• */backblast* - Post a workout report
• */preblast* - Announce an upcoming workout
• */f3-calendar* - View the workout calendar
• */f3-nation-settings* - Configure region settings

*Quick Actions:*
Use the buttons below to get started quickly!

*Need more help?*
Mention me with @F3 Nation in any channel and I'll respond with quick action buttons.`,
    },
  };

  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Help Menu",
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    blocks: [buttonBlock, helpTextBlock],
  };
}

/**
 * Register help feature handlers with the Bolt app
 */
export function registerHelpFeature(app: App): void {
  // Slash command - /help
  app.command("/help", async ({ command, ack, client }) => {
    await ack();

    logger.info("Help command received", {
      user: command.user_id,
      team: command.team_id,
    });

    try {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildHelpModal(),
      });
    } catch (error) {
      logger.error("Failed to open help modal", error);
    }
  });

  // App mention event
  app.event("app_mention", async ({ event, client }) => {
    const userId = event.user;
    const channelId = event.channel;

    if (!userId) {
      logger.warn("App mention received without user ID");
      return;
    }

    logger.info("App mention received", {
      user: userId,
      channel: channelId,
    });

    const blocks: (SectionBlock | ActionsBlock)[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Hi there! Looking for me? 👋\n\nHere are some things I can help you with:",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "📅 Open Calendar",
              emoji: true,
            },
            action_id: ACTIONS.OPEN_CALENDAR_BUTTON,
          } satisfies Button,
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "📝 Create Preblast",
              emoji: true,
            },
            action_id: ACTIONS.PREBLAST_NEW_BUTTON,
          } satisfies Button,
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❓ Help Menu",
              emoji: true,
            },
            action_id: ACTIONS.CONFIG_HELP_MENU,
          } satisfies Button,
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "⚙️ Settings",
              emoji: true,
            },
            action_id: ACTIONS.SETTINGS_BUTTON,
          } satisfies Button,
        ],
      },
    ];

    try {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Hi there! Looking for me? 👋",
        blocks,
      });
    } catch (error) {
      logger.error("Failed to respond to app mention", error);
    }
  });

  // Help menu button action (opens modal from button)
  app.action(ACTIONS.CONFIG_HELP_MENU, async ({ ack, body, client }) => {
    await ack();

    // BlockAction type has trigger_id
    const triggerId = "trigger_id" in body ? body.trigger_id : undefined;

    if (!triggerId) {
      logger.warn("Help menu button clicked without trigger_id");
      return;
    }

    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildHelpModal(),
      });
    } catch (error) {
      logger.error("Failed to open help modal from button", error);
    }
  });

  // Placeholder for unimplemented actions
  app.action(ACTIONS.OPEN_CALENDAR_BUTTON, async ({ ack, say }: any) => {
    await ack();
    await say("The Calendar feature is coming soon in Phase 2! 📅");
  });

  app.action(ACTIONS.PREBLAST_NEW_BUTTON, async ({ ack, say }: any) => {
    await ack();
    await say("The Preblast feature is coming soon in Phase 2! 📝");
  });

  logger.info("Help feature registered");
}
