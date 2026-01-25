import type { App } from "@slack/bolt";
import { ACTIONS } from "../../constants/actions";
import type {
  BlockList,
  ExtendedContext,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { manageLocations, registerLocationHandlers } from "./location";
import { manageAOs, registerAOHandlers } from "./ao";
import { manageEventTypes, registerEventTypeHandlers } from "./event-type";
import { manageEventTags, registerEventTagHandlers } from "./event-tag";
import { manageSeries, registerSeriesHandlers } from "./series";
import {
  manageEventInstances,
  registerEventInstanceHandlers,
} from "./event-instance";
import {
  buildCalendarGeneralConfigForm,
  handleCalendarConfigGeneral,
} from "./settings";
import { createNavContext } from "../../lib/view-navigation";

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
      type: "section",
      text: {
        type: "plain_text",
        text: ":spiral_calendar_pad: Manage Series",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_SERIES,
        options: [
          {
            text: { type: "plain_text", text: "Add Series" },
            value: "add",
          },
          {
            text: { type: "plain_text", text: "Edit or Delete Series" },
            value: "edit",
          },
        ],
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: ":date: Manage Event Instances",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCES,
        options: [
          {
            text: { type: "plain_text", text: "Add Event Instance" },
            value: "add",
          },
          {
            text: {
              type: "plain_text",
              text: "Edit or Delete Event Instances",
            },
            value: "edit",
          },
        ],
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: ":runner: Manage Event Types",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_EVENT_TYPES,
        options: [
          {
            text: { type: "plain_text", text: "Add Event Type" },
            value: "add",
          },
          {
            text: { type: "plain_text", text: "Edit or Delete Event Types" },
            value: "edit",
          },
        ],
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: ":label: Manage Event Tags",
      },
      accessory: {
        type: "overflow",
        action_id: ACTIONS.CALENDAR_MANAGE_EVENT_TAGS,
        options: [
          {
            text: { type: "plain_text", text: "Add Event Tag" },
            value: "add",
          },
          {
            text: { type: "plain_text", text: "Edit or Delete Event Tags" },
            value: "edit",
          },
        ],
      },
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
    await buildCalendarGeneralConfigForm(navCtx);
  });

  // View: Calendar General Config submission
  app.view(
    ACTIONS.CALENDAR_CONFIG_GENERAL_CALLBACK_ID,
    async (args: TypedViewArgs) => {
      await handleCalendarConfigGeneral(args);
    },
  );

  // Locations
  app.action(ACTIONS.CALENDAR_MANAGE_LOCATIONS, manageLocations);
  registerLocationHandlers(app);

  // AOs
  app.action(ACTIONS.CALENDAR_MANAGE_AOS, manageAOs);
  registerAOHandlers(app);

  // Event Types
  app.action(ACTIONS.CALENDAR_MANAGE_EVENT_TYPES, manageEventTypes);
  registerEventTypeHandlers(app);

  // Event Tags
  app.action(ACTIONS.CALENDAR_MANAGE_EVENT_TAGS, manageEventTags);
  registerEventTagHandlers(app);

  // Series
  app.action(ACTIONS.CALENDAR_MANAGE_SERIES, manageSeries);
  registerSeriesHandlers(app);

  // Event Instances
  app.action(ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCES, manageEventInstances);
  registerEventInstanceHandlers(app);
}
