import type { App } from "@slack/bolt";
import type { ModalView } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import type {
  BlockList,
  ExtendedContext,
  NavigationMetadata,
  TypedActionArgs,
  TypedCommandArgs,
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
import type { CalendarHomeBuildOptions } from "./home";
import { buildCalendarHomeModal } from "./home";
import { handleFilterChange, handleEventAction } from "./home-handlers";
import { handleAssignQSubmit } from "./assign-q-handlers";
import { api } from "../../lib/api-client";

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
    close: { type: "plain_text" as const, text: "Close" },
    blocks,
  };
}

/**
 * Open the calendar home modal.
 * Fetches user admin status and builds the calendar view.
 */
async function openCalendarHome(
  navCtx: ReturnType<typeof createNavContext>,
  context: ExtendedContext,
): Promise<void> {
  const userId = context.slackUser?.userId;
  const regionOrgId = context.orgId;

  if (!userId || !regionOrgId) {
    logger.warn("Cannot open calendar home: missing userId or regionOrgId", {
      userId,
      regionOrgId,
    });
    return;
  }

  // Check if user is admin
  let userIsAdmin = false;
  try {
    const rolesResult = await api.slack.getUserRoles(
      context.userId ?? "",
      context.teamId ?? "",
    );
    userIsAdmin = rolesResult.isAdmin ?? rolesResult.isEditor ?? false;
  } catch (error) {
    logger.warn("Failed to check user admin status", { error });
  }

  const buildOptions: CalendarHomeBuildOptions = {
    regionOrgId,
    userId,
    userIsAdmin,
  };

  await navigateToView(
    navCtx,
    async (metadata: NavigationMetadata): Promise<ModalView> => {
      return buildCalendarHomeModal(buildOptions, metadata);
    },
    { showLoading: true, loadingTitle: "Loading Calendar..." },
  );
}

/**
 * Register Calendar feature
 */
export function registerCalendarFeature(app: App) {
  // =====================================================
  // Calendar Home - Schedule View
  // =====================================================

  // Command: /f3-calendar
  app.command("/f3-calendar", async (args: TypedCommandArgs) => {
    const { ack, body, client, context } = args;
    await ack();

    logger.info("Calendar command received", { user: body.user_id });

    const navCtx = createNavContext({ client, body, context });
    await openCalendarHome(navCtx, context as ExtendedContext);
  });

  // Shortcut: calendar_shortcut
  app.shortcut(
    ACTIONS.CALENDAR_SHORTCUT,
    async ({ ack, shortcut, client, context }) => {
      await ack();

      logger.info("Calendar shortcut triggered", { user: shortcut.user.id });

      const navCtx = createNavContext({
        client,
        body: shortcut,
        context,
      });

      await openCalendarHome(navCtx, context as ExtendedContext);
    },
  );

  // Action: Open calendar button (from help menu, etc.)
  app.action(
    ACTIONS.OPEN_CALENDAR_BUTTON,
    async ({ ack, body, client, context }: TypedActionArgs) => {
      await ack();

      logger.info("Open calendar button clicked");

      const navCtx = createNavContext({ client, body, context });
      await openCalendarHome(navCtx, context as ExtendedContext);
    },
  );

  // Action: Open calendar message button
  app.action(
    ACTIONS.OPEN_CALENDAR_MSG_BUTTON,
    async ({ ack, body, client, context }: TypedActionArgs) => {
      await ack();

      logger.info("Open calendar message button clicked");

      const navCtx = createNavContext({ client, body, context });
      await openCalendarHome(navCtx, context as ExtendedContext);
    },
  );

  // Filter change actions - rebuild calendar view
  app.action(ACTIONS.CALENDAR_HOME_AO_FILTER, handleFilterChange);
  app.action(ACTIONS.CALENDAR_HOME_EVENT_TYPE_FILTER, handleFilterChange);
  app.action(ACTIONS.CALENDAR_HOME_DATE_FILTER, handleFilterChange);
  app.action(ACTIONS.CALENDAR_HOME_Q_FILTER, handleFilterChange);

  // Event overflow menu actions (regex to match action IDs like "calendar-home-event_123")
  app.action(
    new RegExp(`^${ACTIONS.CALENDAR_HOME_EVENT}_\\d+$`),
    handleEventAction,
  );

  // Assign Q modal submission
  app.view(ACTIONS.ASSIGN_Q_CALLBACK_ID, async (args: TypedViewArgs) => {
    await handleAssignQSubmit(args);
  });

  // =====================================================
  // Calendar Config - Admin Settings
  // =====================================================

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

// Export calendar home components for use by other features
export { buildCalendarHomeModal } from "./home";
export type { CalendarHomeBuildOptions } from "./home";
export type {
  CalendarHomeEvent,
  CalendarHomeFilterState,
  CalendarHomeMetadata,
} from "./home-types";
