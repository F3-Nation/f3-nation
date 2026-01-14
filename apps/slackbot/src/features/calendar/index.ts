import type { App } from "@slack/bolt";
import { ACTIONS } from "../../constants/actions";
import type {
  BlockList,
  ExtendedContext,
  TypedActionArgs,
} from "../../types/bolt-types";
import { manageLocations, registerLocationHandlers } from "./location";
import { manageAOs, registerAOHandlers } from "./ao";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Build the calendar configuration menu modal
 */
export function buildCalendarConfigModal(_context: ExtendedContext) {
  const blocks: BlockList = [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":gear: General Calendar Settings",
          },
          action_id: ACTIONS.CALENDAR_CONFIG_GENERAL,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: ":round_pushpin: Manage Locations",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_LOCATIONS,
        options: [
          {
            text: { type: "plain_text", text: "Add Location" },
            value: "add",
          },
          {
            text: { type: "plain_text", text: "Edit or Deactivate Locations" },
            value: "edit",
          },
        ],
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: ":world_map: Manage AOs",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_AOS,
        options: [
          {
            text: { type: "plain_text", text: "Add AO" },
            value: "add",
          },
          {
            text: { type: "plain_text", text: "Edit or Deactivate AOs" },
            value: "edit",
          },
        ],
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":spiral_calendar_pad: Manage Series",
          },
          action_id: ACTIONS.CALENDAR_MANAGE_SERIES,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":date: Manage Event Instances",
          },
          action_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCES,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":runner: Manage Event Types" },
          action_id: ACTIONS.CALENDAR_MANAGE_EVENT_TYPES,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":label: Manage Event Tags" },
          action_id: ACTIONS.CALENDAR_MANAGE_EVENT_TAGS,
        },
      ],
    },
  ];

  return {
    type: "modal" as const,
    callback_id: ACTIONS.CALENDAR_CONFIG_CALLBACK_ID,
    title: { type: "plain_text" as const, text: "Calendar Settings" },
    close: { type: "plain_text" as const, text: "Back" },
    blocks,
  };
}

/**
 * Register Calendar feature
 */
export function registerCalendarFeature(app: App) {
  // Action: Open Calendar General Config
  app.action(ACTIONS.CALENDAR_CONFIG_GENERAL, async (args: TypedActionArgs) => {
    const { ack } = args;
    await ack();
    const navCtx = createNavContext(args);

    await navigateToView(navCtx, () => ({
      type: "modal",
      title: { type: "plain_text", text: "General Calendar Settings" },
      close: { type: "plain_text", text: "Back" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "General calendar settings will be implemented in Phase 2h.",
          },
        },
      ],
    }));
  });

  // Locations
  app.action(ACTIONS.CALENDAR_MANAGE_LOCATIONS, manageLocations);
  registerLocationHandlers(app);

  // AOs
  app.action(ACTIONS.CALENDAR_MANAGE_AOS, manageAOs);
  registerAOHandlers(app);

  // Placeholder handlers for other management options
  const managementActions = [
    ACTIONS.CALENDAR_MANAGE_SERIES,
    ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCES,
    ACTIONS.CALENDAR_MANAGE_EVENT_TYPES,
    ACTIONS.CALENDAR_MANAGE_EVENT_TAGS,
  ] as const;

  for (const actionId of managementActions) {
    app.action(actionId, async (args: TypedActionArgs) => {
      const { ack } = args;
      await ack();
      const navCtx = createNavContext(args);

      await navigateToView(navCtx, () => ({
        type: "modal",
        title: { type: "plain_text", text: "Management" },
        close: { type: "plain_text", text: "Back" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Management for ${actionId} will be implemented in subsequent phases.`,
            },
          },
        ],
      }));
    });
  }
}
