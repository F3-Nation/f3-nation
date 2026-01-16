import { api } from "../../lib/api-client";
import type { NavigationContext } from "../../lib/view-navigation";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import { ACTIONS } from "../../constants/actions";
import type {
  BlockList,
  SlackStateValues,
  TypedViewArgs,
} from "../../types/bolt-types";
import { logger } from "../../lib/logger";
import type { RegionSettings } from "../../types";
import type { SlackSpaceResponse } from "../../types/api-types";

export const CALENDAR_CONFIG_POST_CALENDAR_IMAGE =
  "calendar_config_post_calendar_image";
export const CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL =
  "calendar_config_calendar_image_channel";
export const CALENDAR_CONFIG_Q_LINEUP_METHOD =
  "calendar_config_q_lineup_method";
export const CALENDAR_CONFIG_Q_LINEUP_CHANNEL =
  "calendar_config_q_lineup_channel";
export const CALENDAR_CONFIG_Q_LINEUP_DAY = "calendar_config_q_lineup_day";
export const CALENDAR_CONFIG_Q_LINEUP_TIME = "calendar_config_q_lineup_time";

/**
 * Build general calendar settings form
 */
export async function buildCalendarGeneralConfigForm(
  navCtx: NavigationContext,
) {
  await navigateToView(
    navCtx,
    async () => {
      const space: SlackSpaceResponse | null = await api.slack.getSpace(
        navCtx.teamId,
      );
      const settings: Partial<RegionSettings> = space?.settings ?? {};

      const qLineupTime = settings.send_q_lineups_hour_cst
        ? `${settings.send_q_lineups_hour_cst.toString().padStart(2, "0")}:00`
        : "17:00";

      const blocks: BlockList = [
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_CONFIG_Q_LINEUP,
          label: { type: "plain_text", text: "Send Q Lineups" },
          element: {
            type: "radio_buttons",
            action_id: ACTIONS.CALENDAR_CONFIG_Q_LINEUP,
            options: [
              { text: { type: "plain_text", text: "Yes" }, value: "yes" },
              { text: { type: "plain_text", text: "No" }, value: "no" },
            ],
            initial_option: {
              text: {
                type: "plain_text",
                text: settings.send_q_lineups ? "Yes" : "No",
              },
              value: settings.send_q_lineups ? "yes" : "no",
            },
          },
        },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_Q_LINEUP_METHOD,
          label: { type: "plain_text", text: "How should they be sent?" },
          optional: true,
          element: {
            type: "radio_buttons",
            action_id: CALENDAR_CONFIG_Q_LINEUP_METHOD,
            options: [
              {
                text: { type: "plain_text", text: "One Per AO" },
                value: "yes_per_ao",
              },
              {
                text: { type: "plain_text", text: "One For All AOs" },
                value: "yes_for_all",
              },
            ],
            initial_option: {
              text: {
                type: "plain_text",
                text:
                  settings.send_q_lineups_method === "yes_for_all"
                    ? "One For All AOs"
                    : "One Per AO",
              },
              value: settings.send_q_lineups_method ?? "yes_per_ao",
            },
          },
        },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_Q_LINEUP_CHANNEL,
          label: { type: "plain_text", text: "Region Q Lineup Channel" },
          optional: true,
          element: {
            type: "channels_select",
            action_id: CALENDAR_CONFIG_Q_LINEUP_CHANNEL,
            placeholder: { type: "plain_text", text: "Select a channel" },
            ...(settings.send_q_lineups_channel
              ? { initial_channel: settings.send_q_lineups_channel }
              : {}),
          },
        },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_Q_LINEUP_DAY,
          label: { type: "plain_text", text: "Region Q Lineup Day" },
          element: {
            type: "static_select",
            action_id: CALENDAR_CONFIG_Q_LINEUP_DAY,
            options: [
              { text: { type: "plain_text", text: "Monday" }, value: "0" },
              { text: { type: "plain_text", text: "Tuesday" }, value: "1" },
              { text: { type: "plain_text", text: "Wednesday" }, value: "2" },
              { text: { type: "plain_text", text: "Thursday" }, value: "3" },
              { text: { type: "plain_text", text: "Friday" }, value: "4" },
              { text: { type: "plain_text", text: "Saturday" }, value: "5" },
              { text: { type: "plain_text", text: "Sunday" }, value: "6" },
            ],
            initial_option: {
              text: {
                type: "plain_text",
                text:
                  [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ][settings.send_q_lineups_day ?? 6] ?? "Sunday",
              },
              value: (settings.send_q_lineups_day ?? 6).toString(),
            },
          },
        },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_Q_LINEUP_TIME,
          label: { type: "plain_text", text: "Region Q Lineup Time (CST)" },
          element: {
            type: "timepicker",
            action_id: CALENDAR_CONFIG_Q_LINEUP_TIME,
            initial_time: qLineupTime,
          },
        },
        { type: "divider" },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_POST_CALENDAR_IMAGE,
          label: { type: "plain_text", text: "Post Calendar Image" },
          element: {
            type: "radio_buttons",
            action_id: CALENDAR_CONFIG_POST_CALENDAR_IMAGE,
            options: [
              { text: { type: "plain_text", text: "Yes" }, value: "yes" },
              { text: { type: "plain_text", text: "No" }, value: "no" },
            ],
            initial_option: {
              text: {
                type: "plain_text",
                text: settings.q_image_posting_enabled ? "Yes" : "No",
              },
              value: settings.q_image_posting_enabled ? "yes" : "no",
            },
          },
        },
        {
          type: "input",
          block_id: CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL,
          label: { type: "plain_text", text: "Calendar Image Channel" },
          optional: true,
          element: {
            type: "channels_select",
            action_id: CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL,
            placeholder: { type: "plain_text", text: "Select a channel" },
            ...(settings.q_image_posting_channel
              ? { initial_channel: settings.q_image_posting_channel }
              : {}),
          },
        },
      ];

      return {
        type: "modal",
        callback_id: ACTIONS.CALENDAR_CONFIG_GENERAL_CALLBACK_ID,
        title: { type: "plain_text", text: "Calendar Settings" },
        blocks,
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Back" },
        private_metadata: JSON.stringify(navCtx.metadata),
      };
    },
    { showLoading: true },
  );
}

/**
 * Handle settings submission
 */
export async function handleCalendarConfigGeneral(args: TypedViewArgs) {
  const { ack, view } = args;
  await ack();

  const values = view.state.values as unknown as SlackStateValues;

  const getVal = (blockId: string, actionId: string) =>
    values[blockId]?.[actionId];

  const qLineupTime = getVal(
    CALENDAR_CONFIG_Q_LINEUP_TIME,
    CALENDAR_CONFIG_Q_LINEUP_TIME,
  )?.selected_time;
  const hourCst = qLineupTime
    ? parseInt(qLineupTime.split(":")[0] ?? "17")
    : 17;

  const settings: Partial<RegionSettings> = {
    send_q_lineups:
      getVal(ACTIONS.CALENDAR_CONFIG_Q_LINEUP, ACTIONS.CALENDAR_CONFIG_Q_LINEUP)
        ?.selected_option?.value === "yes",
    send_q_lineups_method: getVal(
      CALENDAR_CONFIG_Q_LINEUP_METHOD,
      CALENDAR_CONFIG_Q_LINEUP_METHOD,
    )?.selected_option?.value,
    send_q_lineups_channel: getVal(
      CALENDAR_CONFIG_Q_LINEUP_CHANNEL,
      CALENDAR_CONFIG_Q_LINEUP_CHANNEL,
    )?.selected_channel,
    q_image_posting_enabled:
      getVal(
        CALENDAR_CONFIG_POST_CALENDAR_IMAGE,
        CALENDAR_CONFIG_POST_CALENDAR_IMAGE,
      )?.selected_option?.value === "yes",
    q_image_posting_channel: getVal(
      CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL,
      CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL,
    )?.selected_channel,
    send_q_lineups_day: parseInt(
      getVal(CALENDAR_CONFIG_Q_LINEUP_DAY, CALENDAR_CONFIG_Q_LINEUP_DAY)
        ?.selected_option?.value ?? "6",
    ),
    send_q_lineups_hour_cst: hourCst,
  };

  try {
    const navCtx = createNavContext(args);
    await api.slack.updateSpaceSettings(navCtx.teamId, settings);
  } catch (error) {
    logger.error("Failed to update calendar settings", error);
  }
}
