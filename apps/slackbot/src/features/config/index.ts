import type { App, BlockAction } from "@slack/bolt";
import { ACTIONS } from "../../constants/actions";
import { buildWelcomeConfigModal } from "../welcome";
import { buildCalendarConfigModal } from "../calendar";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import type { RegionSettings } from "../../types";
import type {
  BlockList,
  ExtendedContext,
  TypedActionArgs,
  TypedCommandArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import { stringifyNavMetadata } from "../../types/bolt-types";

/**
 * Build the main configuration menu modal
 */
export function buildConfigModal(context: ExtendedContext) {
  const slackUser = context.slackUser;
  const isAdmin = slackUser?.isAdmin ?? false;

  const blocks: BlockList = [];

  if (isAdmin) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":speech_balloon: Welcomebot Settings",
          },
          action_id: ACTIONS.OPEN_WELCOME_CONFIG,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":gear: General Settings" },
          action_id: ACTIONS.OPEN_GENERAL_CONFIG,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":calendar: Calendar Settings" },
          action_id: ACTIONS.OPEN_CALENDAR_CONFIG,
        },
      ],
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "You do not have permission to access region settings. Please contact your region admin.",
      },
    });
  }

  return {
    type: "modal" as const,
    callback_id: ACTIONS.CONFIG_CALLBACK_ID,
    title: { type: "plain_text" as const, text: "F3 Nation Settings" },
    blocks,
  };
}

/**
 * Register Config feature
 */
export function registerConfigFeature(app: App) {
  // Slash command
  app.command(
    "/f3-nation-settings",
    async ({ ack, body, client, context }: TypedCommandArgs) => {
      await ack();
      const modal: any = buildConfigModal(context);
      // Initialize with depth 1
      modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
      await client.views.open({
        trigger_id: body.trigger_id,
        view: modal,
      });
    },
  );

  // Global shortcut
  app.shortcut("settings_shortcut", async (args: any) => {
    const { ack, shortcut, client, context } = args;
    await ack();
    const modal: any = buildConfigModal(context as ExtendedContext);
    // Initialize with depth 1
    modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: modal,
    });
  });

  // Action: Open Main Config Modal (from Settings button)
  app.action(ACTIONS.SETTINGS_BUTTON, async (args: TypedActionArgs) => {
    const { ack, client, body, context } = args;
    await ack();
    const modal: any = buildConfigModal(context);
    modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
    await client.views.open({
      trigger_id: (body as BlockAction).trigger_id,
      view: modal,
    });
  });

  // Action: Open Welcome Config
  app.action(ACTIONS.OPEN_WELCOME_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () =>
      buildWelcomeConfigModal(context.regionSettings),
    );
  });

  // Action: Open General Config
  app.action(ACTIONS.OPEN_GENERAL_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () =>
      buildGeneralConfigModal(context.regionSettings),
    );
  });

  // Action: Open Calendar Config
  app.action(ACTIONS.OPEN_CALENDAR_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () => buildCalendarConfigModal(context));
  });

  // Action handler for saving general settings
  app.view(
    ACTIONS.CONFIG_CALLBACK_ID,
    async ({ ack, view, body }: TypedViewArgs) => {
      await ack();
      // Implementation for saving general settings
      const teamId = body.team?.id;
      if (!teamId) return;

      const values = view.state.values;
      const editingLocked =
        values[ACTIONS.CONFIG_EDITING_LOCKED]?.[ACTIONS.CONFIG_EDITING_LOCKED]
          ?.selected_option?.value === "yes";

      try {
        await api.slack.updateSpaceSettings(teamId, {
          editing_locked: editingLocked,
          // Add other fields as needed
        });
        logger.info(`Updated general settings for team ${teamId}`);
      } catch (error) {
        logger.error("Error saving general settings:", error);
      }
    },
  );
}

/**
 * Build the General Settings modal
 */
export function buildGeneralConfigModal(regionSettings?: RegionSettings) {
  return {
    type: "modal" as const,
    callback_id: ACTIONS.CONFIG_CALLBACK_ID, // Reusing callback ID or use a specific one
    title: { type: "plain_text" as const, text: "General Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "input",
        block_id: ACTIONS.CONFIG_EDITING_LOCKED,
        label: { type: "plain_text", text: "Lock editing of backblasts?" },
        element: {
          type: "radio_buttons",
          action_id: ACTIONS.CONFIG_EDITING_LOCKED,
          initial_option: {
            text: {
              type: "plain_text",
              text: regionSettings?.editing_locked ? "Yes" : "No",
            },
            value: regionSettings?.editing_locked ? "yes" : "no",
          },
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No" }, value: "no" },
          ],
        },
      },
      // Add more settings here based on RegionSettings
    ] as BlockList,
  };
}
