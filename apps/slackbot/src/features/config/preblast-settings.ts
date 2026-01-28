import type { App } from "@slack/bolt";
import type { ModalView, RichTextBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import {
  AUTOMATED_PREBLAST_OPTIONS,
  CONFIG_DESTINATION_OPTIONS,
  DEFAULT_PREBLAST_MOLESKINE_TEMPLATE,
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
 * Build the Preblast Settings modal
 */
export function buildPreblastConfigModal(orgSettings?: OrgSettings): ModalView {
  const currentDestination =
    orgSettings?.default_preblast_destination ??
    CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.value;
  const currentChannel = orgSettings?.preblast_destination_channel;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const currentTemplate = orgSettings?.preblast_moleskin_template
    ? JSON.parse(orgSettings.preblast_moleskin_template)
    : undefined;
  const automatedOption =
    orgSettings?.automated_preblast_option ??
    AUTOMATED_PREBLAST_OPTIONS.DISABLE.value;
  const automatedHour = orgSettings?.automated_preblast_hour_cst ?? 17; // 5pm CST default

  // Format hour for timepicker (HH:MM)
  const automatedTime = `${automatedHour.toString().padStart(2, "0")}:00`;

  const blocks: BlockList = [
    {
      type: "input",
      block_id: ACTIONS.CONFIG_PREBLAST_DESTINATION,
      label: { type: "plain_text", text: "Default Slack channel destination" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.CONFIG_PREBLAST_DESTINATION,
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
      block_id: ACTIONS.CONFIG_PREBLAST_DESTINATION_CHANNEL,
      label: { type: "plain_text", text: "Specified Channel" },
      optional: true,
      element: {
        type: "channels_select",
        action_id: ACTIONS.CONFIG_PREBLAST_DESTINATION_CHANNEL,
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
      block_id: ACTIONS.CONFIG_PREBLAST_MOLESKINE_TEMPLATE,
      label: { type: "plain_text", text: "Preblast Moleskine Template" },
      optional: true,
      element: {
        type: "rich_text_input",
        action_id: ACTIONS.CONFIG_PREBLAST_MOLESKINE_TEMPLATE,
        initial_value: (currentTemplate ??
          DEFAULT_PREBLAST_MOLESKINE_TEMPLATE) as RichTextBlock,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_This template will be pre-filled when creating a new preblast._",
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Automated Preblast Settings*\n_Configure automated preblast posting for scheduled events._",
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_AUTOMATED_PREBLAST,
      label: { type: "plain_text", text: "Automated Preblast Option" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.CONFIG_AUTOMATED_PREBLAST,
        initial_option: getAutomatedPreblastInitialOption(automatedOption),
        options: [
          {
            text: {
              type: "plain_text",
              text: AUTOMATED_PREBLAST_OPTIONS.SEND_FOR_QS.name,
            },
            value: AUTOMATED_PREBLAST_OPTIONS.SEND_FOR_QS.value,
            description: {
              type: "plain_text",
              text: "Only send preblasts for events that have a Q assigned",
            },
          },
          {
            text: {
              type: "plain_text",
              text: AUTOMATED_PREBLAST_OPTIONS.SEND_EVEN_NO_Q.name,
            },
            value: AUTOMATED_PREBLAST_OPTIONS.SEND_EVEN_NO_Q.value,
            description: {
              type: "plain_text",
              text: "Send preblasts for all events, even if no Q is assigned",
            },
          },
          {
            text: {
              type: "plain_text",
              text: AUTOMATED_PREBLAST_OPTIONS.DISABLE.name,
            },
            value: AUTOMATED_PREBLAST_OPTIONS.DISABLE.value,
            description: {
              type: "plain_text",
              text: "Do not send automated preblasts",
            },
          },
        ],
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_AUTOMATED_PREBLAST_TIME,
      label: { type: "plain_text", text: "Automated Preblast Time (CST)" },
      element: {
        type: "timepicker",
        action_id: ACTIONS.CONFIG_AUTOMATED_PREBLAST_TIME,
        initial_time: automatedTime,
        placeholder: {
          type: "plain_text",
          text: "Select time",
        },
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Time of day (in Central Time) to send automated preblasts for the next day's events._",
        },
      ],
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.PREBLAST_CONFIG_CALLBACK_ID,
    title: { type: "plain_text", text: "Preblast Settings" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Back" },
    blocks,
  } as ModalView;
}

/**
 * Get the initial option object for the automated preblast radio buttons
 * Note: Must include description to exactly match the options array
 */
function getAutomatedPreblastInitialOption(value: string) {
  switch (value) {
    case AUTOMATED_PREBLAST_OPTIONS.SEND_FOR_QS.value:
      return {
        text: {
          type: "plain_text" as const,
          text: AUTOMATED_PREBLAST_OPTIONS.SEND_FOR_QS.name,
        },
        value: AUTOMATED_PREBLAST_OPTIONS.SEND_FOR_QS.value,
        description: {
          type: "plain_text" as const,
          text: "Only send preblasts for events that have a Q assigned",
        },
      };
    case AUTOMATED_PREBLAST_OPTIONS.SEND_EVEN_NO_Q.value:
      return {
        text: {
          type: "plain_text" as const,
          text: AUTOMATED_PREBLAST_OPTIONS.SEND_EVEN_NO_Q.name,
        },
        value: AUTOMATED_PREBLAST_OPTIONS.SEND_EVEN_NO_Q.value,
        description: {
          type: "plain_text" as const,
          text: "Send preblasts for all events, even if no Q is assigned",
        },
      };
    default:
      return {
        text: {
          type: "plain_text" as const,
          text: AUTOMATED_PREBLAST_OPTIONS.DISABLE.name,
        },
        value: AUTOMATED_PREBLAST_OPTIONS.DISABLE.value,
        description: {
          type: "plain_text" as const,
          text: "Do not send automated preblasts",
        },
      };
  }
}

/**
 * Handle preblast config form submission
 */
export async function handlePreblastConfigSubmit({
  ack,
  view,
  body,
}: TypedViewArgs) {
  await ack();

  const teamId = body.team?.id;
  if (!teamId) {
    logger.warn("No team ID found in preblast config submission");
    return;
  }

  const values = view.state.values as unknown as SlackStateValues;

  const destination =
    values[ACTIONS.CONFIG_PREBLAST_DESTINATION]?.[
      ACTIONS.CONFIG_PREBLAST_DESTINATION
    ]?.selected_option?.value ?? CONFIG_DESTINATION_OPTIONS.AO_CHANNEL.value;

  const destinationChannel =
    values[ACTIONS.CONFIG_PREBLAST_DESTINATION_CHANNEL]?.[
      ACTIONS.CONFIG_PREBLAST_DESTINATION_CHANNEL
    ]?.selected_channel ?? undefined;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const moleskineTemplate =
    values[ACTIONS.CONFIG_PREBLAST_MOLESKINE_TEMPLATE]?.[
      ACTIONS.CONFIG_PREBLAST_MOLESKINE_TEMPLATE
    ]?.rich_text_value ?? undefined;

  const automatedOption =
    values[ACTIONS.CONFIG_AUTOMATED_PREBLAST]?.[
      ACTIONS.CONFIG_AUTOMATED_PREBLAST
    ]?.selected_option?.value ?? AUTOMATED_PREBLAST_OPTIONS.DISABLE.value;

  const automatedTime =
    values[ACTIONS.CONFIG_AUTOMATED_PREBLAST_TIME]?.[
      ACTIONS.CONFIG_AUTOMATED_PREBLAST_TIME
    ]?.selected_time ?? "17:00";

  // Parse hour from time string (HH:MM)
  const automatedHour = parseInt(automatedTime.split(":")[0] ?? "17", 10);

  try {
    await api.slack.updateSpaceSettings(teamId, {
      default_preblast_destination: destination,
      preblast_destination_channel: destinationChannel,
      preblast_moleskin_template: moleskineTemplate
        ? JSON.stringify(moleskineTemplate)
        : undefined,
      automated_preblast_option: automatedOption,
      automated_preblast_hour_cst: automatedHour,
    });

    logger.info(`Updated preblast settings for team ${teamId}`);
  } catch (error) {
    logger.error("Error saving preblast settings:", error);
  }
}

/**
 * Register preblast settings handlers
 */
export function registerPreblastSettingsHandlers(app: App) {
  app.view(ACTIONS.PREBLAST_CONFIG_CALLBACK_ID, handlePreblastConfigSubmit);
}
