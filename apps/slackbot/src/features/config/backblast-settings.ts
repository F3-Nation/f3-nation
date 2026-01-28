import type { App } from "@slack/bolt";
import type { ModalView, RichTextBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import {
  CONFIG_DESTINATION_OPTIONS,
  DEFAULT_BACKBLAST_MOLESKINE_TEMPLATE,
} from "../../constants/templates";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import type { OrgSettings } from "../../types";
import type {
  BlockList,
  SlackStateValues,
  TypedViewArgs,
} from "../../types/bolt-types";

/**
 * Build the Backblast Settings modal
 */
export function buildBackblastConfigModal(
  orgSettings?: OrgSettings,
): ModalView {
  const currentDestination =
    orgSettings?.default_backblast_destination ??
    CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.value;
  const currentChannel = orgSettings?.backblast_destination_channel;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const currentTemplate = orgSettings?.backblast_moleskin_template
    ? JSON.parse(orgSettings.backblast_moleskin_template)
    : undefined;
  const editingLocked = orgSettings?.editing_locked ?? false;
  const stravaEnabled = orgSettings?.strava_enabled ?? false;
  const reminderDays = orgSettings?.backblast_reminder_days ?? 5;

  const blocks: BlockList = [
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
            text: editingLocked ? "Yes" : "No",
          },
          value: editingLocked ? "yes" : "no",
        },
        options: [
          { text: { type: "plain_text", text: "Yes" }, value: "yes" },
          { text: { type: "plain_text", text: "No" }, value: "no" },
        ],
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_When enabled, only the Q who posted a backblast can edit it._",
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_BACKBLAST_DESTINATION,
      label: { type: "plain_text", text: "Default Slack channel destination" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.CONFIG_BACKBLAST_DESTINATION,
        initial_option: {
          text: {
            type: "plain_text",
            text:
              currentDestination ===
              CONFIG_DESTINATION_OPTIONS.SPECIFIED_CHANNEL.value
                ? CONFIG_DESTINATION_OPTIONS.SPECIFIED_CHANNEL.name
                : CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.name,
          },
          value: currentDestination,
        },
        options: [
          {
            text: {
              type: "plain_text",
              text: CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.name,
            },
            value: CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.value,
          },
          {
            text: {
              type: "plain_text",
              text: CONFIG_DESTINATION_OPTIONS.SPECIFIED_CHANNEL.name,
            },
            value: CONFIG_DESTINATION_OPTIONS.SPECIFIED_CHANNEL.value,
          },
        ],
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_BACKBLAST_DESTINATION_CHANNEL,
      label: { type: "plain_text", text: "Specified Channel" },
      optional: true,
      element: {
        type: "channels_select",
        action_id: ACTIONS.CONFIG_BACKBLAST_DESTINATION_CHANNEL,
        placeholder: {
          type: "plain_text",
          text: "Select a channel",
        },
        ...(currentChannel ? { initial_channel: currentChannel } : {}),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: '_Only used when "Specified Channel" is selected above. Leave empty to use AO channel._',
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE,
      label: { type: "plain_text", text: "Backblast Moleskine Template" },
      optional: true,
      element: {
        type: "rich_text_input",
        action_id: ACTIONS.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE,
        initial_value: (currentTemplate ??
          DEFAULT_BACKBLAST_MOLESKINE_TEMPLATE) as RichTextBlock,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_This template will be pre-filled when creating a new backblast._",
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_BACKBLAST_REMINDER_DAYS,
      label: { type: "plain_text", text: "Backblast Reminder Days" },
      element: {
        type: "number_input",
        action_id: ACTIONS.CONFIG_BACKBLAST_REMINDER_DAYS,
        is_decimal_allowed: false,
        min_value: "0",
        max_value: "7",
        initial_value: reminderDays.toString(),
        placeholder: {
          type: "plain_text",
          text: "0-7",
        },
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Number of days after an event to send backblast reminders to the Q (0 = disable)._",
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_ENABLE_STRAVA,
      label: { type: "plain_text", text: "Enable Strava Integration" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.CONFIG_ENABLE_STRAVA,
        initial_option: {
          text: {
            type: "plain_text",
            text: stravaEnabled ? "Enable" : "Disable",
          },
          value: stravaEnabled ? "enable" : "disable",
        },
        options: [
          { text: { type: "plain_text", text: "Enable" }, value: "enable" },
          { text: { type: "plain_text", text: "Disable" }, value: "disable" },
        ],
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_When enabled, users can connect their Strava accounts and attach activities to backblasts._",
        },
      ],
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.BACKBLAST_CONFIG_CALLBACK_ID,
    title: { type: "plain_text", text: "Backblast Settings" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Back" },
    blocks,
  } as ModalView;
}

/**
 * Handle backblast config form submission
 */
export async function handleBackblastConfigSubmit({
  ack,
  view,
  body,
}: TypedViewArgs) {
  await ack();

  const teamId = body.team?.id;
  if (!teamId) {
    logger.warn("No team ID found in backblast config submission");
    return;
  }

  const values = view.state.values as unknown as SlackStateValues;

  const editingLocked =
    values[ACTIONS.CONFIG_EDITING_LOCKED]?.[ACTIONS.CONFIG_EDITING_LOCKED]
      ?.selected_option?.value === "yes";

  const destination =
    values[ACTIONS.CONFIG_BACKBLAST_DESTINATION]?.[
      ACTIONS.CONFIG_BACKBLAST_DESTINATION
    ]?.selected_option?.value ?? CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.value;

  const destinationChannel =
    values[ACTIONS.CONFIG_BACKBLAST_DESTINATION_CHANNEL]?.[
      ACTIONS.CONFIG_BACKBLAST_DESTINATION_CHANNEL
    ]?.selected_channel ?? undefined;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const moleskineTemplate =
    values[ACTIONS.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE]?.[
      ACTIONS.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE
    ]?.rich_text_value ?? undefined;

  const reminderDaysStr =
    values[ACTIONS.CONFIG_BACKBLAST_REMINDER_DAYS]?.[
      ACTIONS.CONFIG_BACKBLAST_REMINDER_DAYS
    ]?.value;
  const reminderDays = reminderDaysStr ? parseInt(reminderDaysStr, 10) : 5;

  const stravaEnabled =
    values[ACTIONS.CONFIG_ENABLE_STRAVA]?.[ACTIONS.CONFIG_ENABLE_STRAVA]
      ?.selected_option?.value === "enable";

  try {
    await api.slack.updateSpaceSettings(teamId, {
      editing_locked: editingLocked,
      default_backblast_destination: destination,
      backblast_destination_channel: destinationChannel,
      backblast_moleskin_template: moleskineTemplate
        ? JSON.stringify(moleskineTemplate)
        : undefined,
      backblast_reminder_days: reminderDays,
      strava_enabled: stravaEnabled,
    });

    logger.info(`Updated backblast settings for team ${teamId}`);
  } catch (error) {
    logger.error("Error saving backblast settings:", error);
  }
}

/**
 * Register backblast settings handlers
 */
export function registerBackblastSettingsHandlers(app: App) {
  app.view(ACTIONS.BACKBLAST_CONFIG_CALLBACK_ID, handleBackblastConfigSubmit);
}
